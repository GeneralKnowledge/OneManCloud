import { timingSafeEqual, sha256Hex, structuredLog } from "@omc/shared";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";

export type AppVariables = {
  nodeId?: string;
  nodeName?: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: AppVariables;
};

function bearer(c: Context): string | null {
  const header = c.req.header("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

export const requireOperator = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearer(c);
  if (!token || !c.env.OPERATOR_TOKEN) {
    structuredLog("AUTH_FAILED", { reason: "missing_operator_token" });
    return c.json({ error: "Unauthorized" }, 401);
  }
  const ok = await timingSafeEqual(token, c.env.OPERATOR_TOKEN);
  if (!ok) {
    structuredLog("AUTH_FAILED", { reason: "invalid_operator_token" });
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

export const requireNode = createMiddleware<AppEnv>(async (c, next) => {
  const token = bearer(c);
  if (!token) {
    structuredLog("AUTH_FAILED", { reason: "missing_node_token" });
    return c.json({ error: "Unauthorized" }, 401);
  }
  const hash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT nt.node_id as node_id, n.name as name
     FROM node_tokens nt
     JOIN nodes n ON n.id = nt.node_id
     WHERE nt.token_hash = ? AND nt.revoked_at IS NULL`,
  )
    .bind(hash)
    .first<{ node_id: string; name: string }>();

  if (!row) {
    structuredLog("AUTH_FAILED", { reason: "invalid_node_token" });
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("nodeId", row.node_id);
  c.set("nodeName", row.name);
  return next();
});

export const requireOperatorOrNode = createMiddleware<AppEnv>(
  async (c, next) => {
    const token = bearer(c);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (
      c.env.OPERATOR_TOKEN &&
      (await timingSafeEqual(token, c.env.OPERATOR_TOKEN))
    ) {
      return next();
    }
    const hash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT nt.node_id as node_id, n.name as name
       FROM node_tokens nt
       JOIN nodes n ON n.id = nt.node_id
       WHERE nt.token_hash = ? AND nt.revoked_at IS NULL`,
    )
      .bind(hash)
      .first<{ node_id: string; name: string }>();
    if (!row) {
      structuredLog("AUTH_FAILED", { reason: "invalid_token" });
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("nodeId", row.node_id);
    c.set("nodeName", row.name);
    return next();
  },
);
