import { Hono } from "hono";
import type { ApplicationConfig } from "@omc/protocol";
import {
  newId,
  parseMemoryMb,
  publicHostname,
  structuredLog,
} from "@omc/shared";
import type { AppEnv } from "../auth";
import { requireOperator } from "../auth";
import {
  getConfigValue,
  mapApp,
  mapDeployment,
  mapJob,
  type AppRow,
  type DeploymentRow,
  type JobRow,
} from "../db";

export const appRoutes = new Hono<AppEnv>();

appRoutes.post("/v1/apps", requireOperator, async (c) => {
  const body = await c.req.json<ApplicationConfig>();
  if (!body.name || body.runtime !== "docker") {
    return c.json({ error: "name and runtime: docker are required" }, 400);
  }
  if (!body.source?.type) {
    return c.json({ error: "source.type is required" }, 400);
  }
  if (body.source.type === "github" && !body.source.repository) {
    return c.json({ error: "source.repository is required for github" }, 400);
  }
  if (body.source.type === "image" && !body.source.image) {
    return c.json({ error: "source.image is required for image" }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM applications WHERE name = ?`,
  )
    .bind(body.name)
    .first<{ id: string }>();

  const now = Date.now();
  const memoryMb = parseMemoryMb(body.compute?.memory);
  const cpu = body.compute?.cpu ?? 1;
  const isPublic = body.network?.public ?? false;
  const sleep = body.sleep ?? true;
  const argsJson = JSON.stringify(body.source.args ?? []);

  let id: string;
  if (existing) {
    id = existing.id;
    await c.env.DB.prepare(
      `UPDATE applications
       SET runtime = ?,
           source_type = ?,
           source_repo = ?,
           source_image = ?,
           source_args_json = ?,
           memory_mb = ?,
           cpu = ?,
           public = ?,
           sleep = ?,
           updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        body.runtime,
        body.source.type,
        body.source.repository ?? null,
        body.source.image ?? null,
        argsJson,
        memoryMb,
        cpu,
        isPublic ? 1 : 0,
        sleep ? 1 : 0,
        now,
        id,
      )
      .run();
  } else {
    id = newId("app");
    await c.env.DB.prepare(
      `INSERT INTO applications (
         id, name, runtime, source_type, source_repo, source_image, source_args_json,
         memory_mb, cpu, public, sleep, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        body.name,
        body.runtime,
        body.source.type,
        body.source.repository ?? null,
        body.source.image ?? null,
        argsJson,
        memoryMb,
        cpu,
        isPublic ? 1 : 0,
        sleep ? 1 : 0,
        now,
        now,
      )
      .run();
  }

  structuredLog("APP_REGISTERED", { applicationId: id, name: body.name });
  const row = await c.env.DB.prepare(`SELECT * FROM applications WHERE id = ?`)
    .bind(id)
    .first<AppRow>();
  return c.json({ application: mapApp(row!) }, existing ? 200 : 201);
});

appRoutes.get("/v1/apps", requireOperator, async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT * FROM applications ORDER BY name ASC`,
  ).all<AppRow>();
  return c.json({
    applications: (result.results ?? []).map(mapApp),
  });
});

appRoutes.get("/v1/apps/:name", requireOperator, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM applications WHERE name = ? OR id = ?`,
  )
    .bind(c.req.param("name"), c.req.param("name"))
    .first<AppRow>();
  if (!row) return c.json({ error: "Application not found" }, 404);
  return c.json({ application: mapApp(row) });
});

appRoutes.post("/v1/apps/:name/deploy", requireOperator, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM applications WHERE name = ? OR id = ?`,
  )
    .bind(c.req.param("name"), c.req.param("name"))
    .first<AppRow>();
  if (!row) return c.json({ error: "Application not found" }, 404);

  const app = mapApp(row);
  const now = Date.now();
  const deploymentId = newId("dep");
  const jobId = newId("job");

  let publicUrl: string | null = null;
  if (app.public) {
    const configured =
      (await getConfigValue(c.env.DB, "base_domain")) ||
      c.env.BASE_DOMAIN ||
      "";
    if (configured) {
      publicUrl = `https://${publicHostname(configured, app.name)}`;
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO deployments (
       id, application_id, node_id, status, public_url, created_at, updated_at
     ) VALUES (?, ?, NULL, 'PENDING', ?, ?, ?)`,
  )
    .bind(deploymentId, app.id, publicUrl, now, now)
    .run();

  const payload = {
    deploymentId,
    applicationId: app.id,
    name: app.name,
    runtime: app.runtime,
    sourceType: app.sourceType,
    sourceRepo: app.sourceRepo,
    sourceImage: app.sourceImage,
    sourceArgs: JSON.parse(app.sourceArgsJson ?? "[]") as string[],
    memoryMb: app.memoryMb,
    cpu: app.cpu,
    public: app.public,
    sleep: app.sleep,
    publicUrl,
  };

  await c.env.DB.prepare(
    `INSERT INTO jobs (
       id, type, application_id, node_id, status, payload_json, result_json,
       attempts, max_attempts, created_at, updated_at, started_at, finished_at
     ) VALUES (?, 'deploy', ?, NULL, 'QUEUED', ?, NULL, 0, 3, ?, ?, NULL, NULL)`,
  )
    .bind(jobId, app.id, JSON.stringify(payload), now, now)
    .run();

  structuredLog("DEPLOYMENT_STARTED", {
    deploymentId,
    applicationId: app.id,
    jobId,
  });
  structuredLog("JOB_CREATED", { jobId, type: "deploy" });

  const deployment = await c.env.DB.prepare(
    `SELECT * FROM deployments WHERE id = ?`,
  )
    .bind(deploymentId)
    .first<DeploymentRow>();
  const job = await c.env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`)
    .bind(jobId)
    .first<JobRow>();

  return c.json(
    {
      deployment: mapDeployment(deployment!),
      job: mapJob(job!),
    },
    201,
  );
});

appRoutes.get("/v1/apps/:name/deployments", requireOperator, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM applications WHERE name = ? OR id = ?`,
  )
    .bind(c.req.param("name"), c.req.param("name"))
    .first<AppRow>();
  if (!row) return c.json({ error: "Application not found" }, 404);
  const result = await c.env.DB.prepare(
    `SELECT * FROM deployments WHERE application_id = ? ORDER BY created_at DESC`,
  )
    .bind(row.id)
    .all<DeploymentRow>();
  return c.json({
    deployments: (result.results ?? []).map(mapDeployment),
  });
});

appRoutes.get("/v1/tunnel", requireOperator, async (c) => {
  const baseDomain =
    (await getConfigValue(c.env.DB, "base_domain")) ||
    c.env.BASE_DOMAIN ||
    null;
  const tunnelToken = await getConfigValue(c.env.DB, "tunnel_token_set");
  return c.json({
    model: {
      preferred: "cloudflare-tunnel",
      requiredForInternalJobs: false,
      baseDomain,
      hostnames: baseDomain
        ? {
            cloud: publicHostname(baseDomain, "cloud"),
            api: publicHostname(baseDomain, "api"),
            appsPattern: `*.${baseDomain}`,
          }
        : null,
      tunnelConfigured: tunnelToken === "true",
      manualSetup: [
        "Install cloudflared on the compute node",
        "Create a Cloudflare Tunnel in Zero Trust",
        "Route app.<base-domain> (or *.base) to localhost:<container-port>",
        "Store tunnel notes via: omc config set tunnel_notes '...'",
      ],
    },
  });
});
