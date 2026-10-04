import { Hono } from "hono";
import { generateToken, newId, sha256Hex, structuredLog } from "@omc/shared";
import type { HeartbeatPayload, RegisterNodeRequest } from "@omc/protocol";
import type { AppEnv } from "../auth";
import { requireNode, requireOperator } from "../auth";
import {
  heartbeatTimeoutMs,
  mapNode,
  markStaleNodesOffline,
  reclaimJobsForOfflineNodes,
  type NodeRow,
} from "../db";

export const nodeRoutes = new Hono<AppEnv>();

nodeRoutes.post("/v1/nodes/register", requireOperator, async (c) => {
  const body = await c.req.json<RegisterNodeRequest>();
  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required" }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM nodes WHERE name = ?`,
  )
    .bind(body.name)
    .first<{ id: string }>();

  const now = Date.now();
  const token = generateToken();
  const tokenHash = await sha256Hex(token);
  let nodeId: string;

  if (existing) {
    nodeId = existing.id;
    await c.env.DB.prepare(
      `UPDATE nodes
       SET status = 'ONLINE',
           hostname = ?,
           arch = ?,
           cpu_count = ?,
           memory_mb = ?,
           disk_gb = ?,
           agent_version = ?,
           last_heartbeat_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        body.hostname ?? null,
        body.arch ?? null,
        body.cpuCount ?? null,
        body.memoryMb ?? null,
        body.diskGb ?? null,
        body.agentVersion ?? null,
        now,
        now,
        nodeId,
      )
      .run();
    await c.env.DB.prepare(
      `UPDATE node_tokens SET revoked_at = ? WHERE node_id = ? AND revoked_at IS NULL`,
    )
      .bind(now, nodeId)
      .run();
  } else {
    nodeId = newId("node");
    await c.env.DB.prepare(
      `INSERT INTO nodes (
         id, name, status, hostname, arch, cpu_count, memory_mb, disk_gb,
         agent_version, last_heartbeat_at, created_at, updated_at
       ) VALUES (?, ?, 'ONLINE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        nodeId,
        body.name,
        body.hostname ?? null,
        body.arch ?? null,
        body.cpuCount ?? null,
        body.memoryMb ?? null,
        body.diskGb ?? null,
        body.agentVersion ?? null,
        now,
        now,
        now,
      )
      .run();
  }

  const tokenId = newId("ntok");
  await c.env.DB.prepare(
    `INSERT INTO node_tokens (id, node_id, token_hash, revoked_at, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
  )
    .bind(tokenId, nodeId, tokenHash, now)
    .run();

  const row = await c.env.DB.prepare(`SELECT * FROM nodes WHERE id = ?`)
    .bind(nodeId)
    .first<NodeRow>();

  structuredLog("NODE_REGISTERED", { nodeId, name: body.name });
  return c.json({ node: mapNode(row!), token }, 201);
});

nodeRoutes.get("/v1/nodes", requireOperator, async (c) => {
  const timeoutMs = heartbeatTimeoutMs(c.env);
  const offlineIds = await markStaleNodesOffline(c.env.DB, timeoutMs);
  for (const id of offlineIds) {
    structuredLog("NODE_OFFLINE", { nodeId: id, reason: "heartbeat_timeout" });
  }
  await reclaimJobsForOfflineNodes(c.env.DB);

  const result = await c.env.DB.prepare(
    `SELECT * FROM nodes ORDER BY name ASC`,
  ).all<NodeRow>();
  return c.json({ nodes: (result.results ?? []).map(mapNode) });
});

nodeRoutes.get("/v1/nodes/:id", requireOperator, async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM nodes WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<NodeRow>();
  if (!row) return c.json({ error: "Node not found" }, 404);
  return c.json({ node: mapNode(row) });
});

nodeRoutes.post("/v1/nodes/heartbeat", requireNode, async (c) => {
  const nodeId = c.get("nodeId")!;
  const body = await c.req.json<HeartbeatPayload>();
  const now = Date.now();

  await c.env.DB.prepare(
    `UPDATE nodes
     SET status = 'ONLINE',
         hostname = ?,
         arch = ?,
         cpu_count = ?,
         memory_mb = ?,
         disk_gb = ?,
         agent_version = ?,
         last_heartbeat_at = ?,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      body.hostname,
      body.arch,
      body.cpuCount,
      body.memoryMb,
      body.diskGb,
      body.agentVersion,
      now,
      now,
      nodeId,
    )
    .run();

  structuredLog("NODE_HEARTBEAT", { nodeId, name: c.get("nodeName") });
  return c.json({ ok: true, status: "ONLINE", serverTime: now });
});

nodeRoutes.post("/v1/nodes/:id/revoke", requireOperator, async (c) => {
  const nodeId = c.req.param("id");
  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE node_tokens SET revoked_at = ? WHERE node_id = ? AND revoked_at IS NULL`,
  )
    .bind(now, nodeId)
    .run();
  await c.env.DB.prepare(
    `UPDATE nodes SET status = 'DISABLED', updated_at = ? WHERE id = ?`,
  )
    .bind(now, nodeId)
    .run();
  return c.json({ ok: true });
});
