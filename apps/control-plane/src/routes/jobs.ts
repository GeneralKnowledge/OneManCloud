import { Hono } from "hono";
import { JOB_TYPES, type CreateJobRequest, type JobType } from "@omc/protocol";
import {
  DEFAULT_JOB_MAX_ATTEMPTS,
  newId,
  structuredLog,
} from "@omc/shared";
import type { AppEnv } from "../auth";
import { requireNode, requireOperator } from "../auth";
import { mapJob, type JobRow } from "../db";

function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}

export const jobRoutes = new Hono<AppEnv>();

jobRoutes.post("/v1/jobs", requireOperator, async (c) => {
  const body = await c.req.json<CreateJobRequest>();
  if (!body.type || !isJobType(body.type)) {
    return c.json(
      { error: `Invalid job type. Allowed: ${JOB_TYPES.join(", ")}` },
      400,
    );
  }

  const id = newId("job");
  const now = Date.now();
  const maxAttempts = body.maxAttempts ?? DEFAULT_JOB_MAX_ATTEMPTS;
  const payloadJson = JSON.stringify(body.payload ?? {});

  await c.env.DB.prepare(
    `INSERT INTO jobs (
       id, type, application_id, node_id, status, payload_json, result_json,
       attempts, max_attempts, created_at, updated_at, started_at, finished_at
     ) VALUES (?, ?, ?, NULL, 'QUEUED', ?, NULL, 0, ?, ?, ?, NULL, NULL)`,
  )
    .bind(
      id,
      body.type,
      body.applicationId ?? null,
      payloadJson,
      maxAttempts,
      now,
      now,
    )
    .run();

  structuredLog("JOB_CREATED", { jobId: id, type: body.type });
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`)
    .bind(id)
    .first<JobRow>();
  return c.json({ job: mapJob(row!) }, 201);
});

jobRoutes.get("/v1/jobs", requireOperator, async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100`,
  ).all<JobRow>();
  return c.json({ jobs: (result.results ?? []).map(mapJob) });
});

jobRoutes.get("/v1/jobs/:id", requireOperator, async (c) => {
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`)
    .bind(c.req.param("id"))
    .first<JobRow>();
  if (!row) return c.json({ error: "Job not found" }, 404);
  return c.json({ job: mapJob(row) });
});

jobRoutes.get("/v1/jobs/:id/logs", requireOperator, async (c) => {
  const logs = await c.env.DB.prepare(
    `SELECT seq, line, created_at FROM job_logs WHERE job_id = ? ORDER BY seq ASC`,
  )
    .bind(c.req.param("id"))
    .all<{ seq: number; line: string; created_at: number }>();
  return c.json({ logs: logs.results ?? [] });
});

jobRoutes.get("/v1/nodes/me/jobs/next", requireNode, async (c) => {
  const nodeId = c.get("nodeId")!;
  const now = Date.now();

  // Prefer jobs pre-assigned to this node (failover fan-out), then unassigned.
  let queued = await c.env.DB.prepare(
    `SELECT * FROM jobs
     WHERE status = 'QUEUED' AND node_id = ?
     ORDER BY created_at ASC LIMIT 1`,
  )
    .bind(nodeId)
    .first<JobRow>();

  if (!queued) {
    queued = await c.env.DB.prepare(
      `SELECT * FROM jobs
       WHERE status = 'QUEUED' AND node_id IS NULL
       ORDER BY created_at ASC LIMIT 1`,
    ).first<JobRow>();
  }

  if (!queued) {
    return c.json({ job: null });
  }

  const updated = await c.env.DB.prepare(
    `UPDATE jobs
     SET status = 'DISPATCHED',
         node_id = COALESCE(node_id, ?),
         attempts = attempts + 1,
         updated_at = ?,
         started_at = ?
     WHERE id = ? AND status = 'QUEUED'
       AND (node_id IS NULL OR node_id = ?)`,
  )
    .bind(nodeId, now, now, queued.id, nodeId)
    .run();

  if (!updated.meta.changes) {
    return c.json({ job: null });
  }

  structuredLog("JOB_DISPATCHED", { jobId: queued.id, nodeId });
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`)
    .bind(queued.id)
    .first<JobRow>();
  return c.json({ job: mapJob(row!) });
});

jobRoutes.post("/v1/jobs/:id/start", requireNode, async (c) => {
  const nodeId = c.get("nodeId")!;
  const jobId = c.req.param("id");
  const now = Date.now();
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`)
    .bind(jobId)
    .first<JobRow>();
  if (!row) return c.json({ error: "Job not found" }, 404);
  if (row.node_id !== nodeId) {
    return c.json({ error: "Job not assigned to this node" }, 403);
  }

  await c.env.DB.prepare(
    `UPDATE jobs SET status = 'RUNNING', updated_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`,
  )
    .bind(now, now, jobId)
    .run();

  structuredLog("JOB_STARTED", { jobId, nodeId });
  return c.json({ ok: true });
});

jobRoutes.post("/v1/jobs/:id/logs", requireNode, async (c) => {
  const nodeId = c.get("nodeId")!;
  const jobId = c.req.param("id");
  const body = await c.req.json<{ lines: string[] }>();
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`)
    .bind(jobId)
    .first<JobRow>();
  if (!row) return c.json({ error: "Job not found" }, 404);
  if (row.node_id !== nodeId) {
    return c.json({ error: "Job not assigned to this node" }, 403);
  }
  if (!Array.isArray(body.lines)) {
    return c.json({ error: "lines must be an array" }, 400);
  }

  const maxSeq = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(seq), 0) as max_seq FROM job_logs WHERE job_id = ?`,
  )
    .bind(jobId)
    .first<{ max_seq: number }>();

  let seq = maxSeq?.max_seq ?? 0;
  const now = Date.now();
  for (const line of body.lines) {
    seq += 1;
    await c.env.DB.prepare(
      `INSERT INTO job_logs (id, job_id, seq, line, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(newId("log"), jobId, seq, String(line), now)
      .run();
  }
  return c.json({ ok: true, appended: body.lines.length });
});

jobRoutes.post("/v1/jobs/:id/complete", requireNode, async (c) => {
  const nodeId = c.get("nodeId")!;
  const jobId = c.req.param("id");
  const body = await c.req.json<{ result?: Record<string, unknown> }>();
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`)
    .bind(jobId)
    .first<JobRow>();
  if (!row) return c.json({ error: "Job not found" }, 404);
  if (row.node_id !== nodeId) {
    return c.json({ error: "Job not assigned to this node" }, 403);
  }

  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE jobs
     SET status = 'SUCCEEDED',
         result_json = ?,
         updated_at = ?,
         finished_at = ?
     WHERE id = ?`,
  )
    .bind(JSON.stringify(body.result ?? {}), now, now, jobId)
    .run();

  if (row.application_id && row.type === "deploy") {
    const payload = JSON.parse(row.payload_json) as {
      deploymentId?: string;
      publicUrl?: string | null;
    };
    const publicUrl =
      (body.result?.publicUrl as string | undefined) ??
      payload.publicUrl ??
      null;

    if (payload.deploymentId) {
      await c.env.DB.prepare(
        `UPDATE deployments
         SET status = 'SUCCEEDED',
             node_id = ?,
             public_url = COALESCE(?, public_url),
             updated_at = ?
         WHERE id = ?`,
      )
        .bind(nodeId, publicUrl, now, payload.deploymentId)
        .run();
    } else {
      await c.env.DB.prepare(
        `UPDATE deployments
         SET status = 'SUCCEEDED',
             node_id = ?,
             public_url = ?,
             updated_at = ?
         WHERE application_id = ?
           AND id = (
             SELECT id FROM deployments
             WHERE application_id = ?
             ORDER BY created_at DESC LIMIT 1
           )`,
      )
        .bind(nodeId, publicUrl, now, row.application_id, row.application_id)
        .run();
    }
    structuredLog("DEPLOYMENT_SUCCEEDED", {
      applicationId: row.application_id,
      deploymentId: payload.deploymentId,
      jobId,
      nodeId,
    });
  }

  structuredLog("JOB_SUCCEEDED", { jobId, nodeId });
  return c.json({ ok: true });
});

jobRoutes.post("/v1/jobs/:id/fail", requireNode, async (c) => {
  const nodeId = c.get("nodeId")!;
  const jobId = c.req.param("id");
  const body = await c.req.json<{ error?: string; retry?: boolean }>();
  const row = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`)
    .bind(jobId)
    .first<JobRow>();
  if (!row) return c.json({ error: "Job not found" }, 404);
  if (row.node_id !== nodeId) {
    return c.json({ error: "Job not assigned to this node" }, 403);
  }

  const now = Date.now();
  const shouldRetry =
    body.retry !== false && row.attempts < row.max_attempts;

  if (shouldRetry) {
    // Keep node affinity for failover replicas so the same node retries.
    await c.env.DB.prepare(
      `UPDATE jobs
       SET status = 'QUEUED',
           result_json = ?,
           updated_at = ?,
           started_at = NULL
       WHERE id = ?`,
    )
      .bind(JSON.stringify({ error: body.error ?? "failed" }), now, jobId)
      .run();
  } else {
    await c.env.DB.prepare(
      `UPDATE jobs
       SET status = 'FAILED',
           result_json = ?,
           updated_at = ?,
           finished_at = ?
       WHERE id = ?`,
    )
      .bind(
        JSON.stringify({ error: body.error ?? "failed" }),
        now,
        now,
        jobId,
      )
      .run();

    if (row.application_id && row.type === "deploy") {
      const payload = JSON.parse(row.payload_json) as {
        deploymentId?: string;
      };
      if (payload.deploymentId) {
        await c.env.DB.prepare(
          `UPDATE deployments
           SET status = 'FAILED', updated_at = ?
           WHERE id = ?`,
        )
          .bind(now, payload.deploymentId)
          .run();
      } else {
        await c.env.DB.prepare(
          `UPDATE deployments
           SET status = 'FAILED', updated_at = ?
           WHERE application_id = ?
             AND id = (
               SELECT id FROM deployments
               WHERE application_id = ?
               ORDER BY created_at DESC LIMIT 1
             )`,
        )
          .bind(now, row.application_id, row.application_id)
          .run();
      }
      structuredLog("DEPLOYMENT_FAILED", {
        applicationId: row.application_id,
        deploymentId: payload.deploymentId,
        jobId,
      });
    }
  }

  structuredLog("JOB_FAILED", {
    jobId,
    nodeId,
    requeued: shouldRetry,
  });
  return c.json({ ok: true, requeued: shouldRetry });
});
