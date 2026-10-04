import { Hono } from "hono";
import { structuredLog } from "@omc/shared";
import type { AppEnv } from "../auth";
import { requireOperator } from "../auth";
import {
  heartbeatTimeoutMs,
  mapApp,
  mapNode,
  markStaleNodesOffline,
  reclaimJobsForOfflineNodes,
  type AppRow,
  type NodeRow,
} from "../db";
import type { StatusResponse } from "@omc/protocol";

export const statusRoutes = new Hono<AppEnv>();

statusRoutes.get("/health", async (c) => {
  return c.json({ ok: true, service: "onemancloud-control-plane" });
});

statusRoutes.post("/v1/auth/verify", requireOperator, async (c) => {
  structuredLog("AUTH_OK", { kind: "operator" });
  return c.json({ ok: true });
});

statusRoutes.get("/v1/status", requireOperator, async (c) => {
  const timeoutMs = heartbeatTimeoutMs(c.env);
  const offlineIds = await markStaleNodesOffline(c.env.DB, timeoutMs);
  for (const id of offlineIds) {
    structuredLog("NODE_OFFLINE", { nodeId: id, reason: "heartbeat_timeout" });
  }
  await reclaimJobsForOfflineNodes(c.env.DB);

  let database: "ONLINE" | "OFFLINE" = "ONLINE";
  try {
    await c.env.DB.prepare("SELECT 1 AS ok").first();
  } catch {
    database = "OFFLINE";
  }

  const nodesResult = await c.env.DB.prepare(
    `SELECT * FROM nodes ORDER BY name ASC`,
  ).all<NodeRow>();
  const appsResult = await c.env.DB.prepare(
    `SELECT * FROM applications ORDER BY name ASC`,
  ).all<AppRow>();
  const queued = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM jobs WHERE status = 'QUEUED'`,
  ).first<{ count: number }>();

  const latestWave = await c.env.DB.prepare(
    `SELECT application_id, MAX(created_at) as max_created
     FROM deployments
     GROUP BY application_id`,
  ).all<{ application_id: string; max_created: number }>();

  const deployByApp = new Map<string, string>();
  for (const wave of latestWave.results ?? []) {
    const rows = await c.env.DB.prepare(
      `SELECT status FROM deployments
       WHERE application_id = ? AND created_at = ?`,
    )
      .bind(wave.application_id, wave.max_created)
      .all<{ status: string }>();
    const statuses = (rows.results ?? []).map((r) => r.status);
    if (statuses.some((s) => s === "SUCCEEDED")) {
      deployByApp.set(wave.application_id, "RUNNING");
    } else if (statuses.some((s) => s === "PENDING")) {
      deployByApp.set(wave.application_id, "PENDING");
    } else if (statuses.some((s) => s === "FAILED")) {
      deployByApp.set(wave.application_id, "FAILED");
    } else {
      deployByApp.set(wave.application_id, statuses[0] ?? "STOPPED");
    }
  }

  const body: StatusResponse = {
    name: "OneManCloud",
    controlPlane: "ONLINE",
    database,
    nodes: (nodesResult.results ?? []).map((row) => {
      const n = mapNode(row);
      return {
        id: n.id,
        name: n.name,
        status: n.status,
        arch: n.arch,
        cpuCount: n.cpuCount,
        memoryMb: n.memoryMb,
        lastHeartbeatAt: n.lastHeartbeatAt,
      };
    }),
    applications: (appsResult.results ?? []).map((row) => {
      const app = mapApp(row);
      return {
        id: app.id,
        name: app.name,
        status: deployByApp.get(app.id) ?? "STOPPED",
        public: app.public,
      };
    }),
    queuedJobs: queued?.count ?? 0,
  };

  structuredLog("STATUS_CHECKED", {
    nodes: body.nodes.length,
    queuedJobs: body.queuedJobs,
  });
  return c.json(body);
});

statusRoutes.get("/v1/config", requireOperator, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT key, value FROM configuration ORDER BY key`,
  ).all<{ key: string; value: string }>();
  const config: Record<string, string> = {};
  for (const row of rows.results ?? []) {
    config[row.key] = row.value;
  }
  if (c.env.BASE_DOMAIN) {
    config.base_domain = c.env.BASE_DOMAIN;
  }
  return c.json({ config });
});

statusRoutes.put("/v1/config/:key", requireOperator, async (c) => {
  const key = c.req.param("key");
  const body = await c.req.json<{ value: string }>();
  if (typeof body.value !== "string") {
    return c.json({ error: "value must be a string" }, 400);
  }
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO configuration (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, body.value, now)
    .run();
  return c.json({ ok: true, key, value: body.value });
});
