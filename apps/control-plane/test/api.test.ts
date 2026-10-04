import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

async function request(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const request = new Request(`http://localhost${path}`, {
    ...init,
    headers,
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const OP = () => env.OPERATOR_TOKEN;

describe("health and auth", () => {
  it("exposes public health", async () => {
    const res = await request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("rejects missing operator token", async () => {
    const res = await request("/v1/status");
    expect(res.status).toBe(401);
  });

  it("rejects invalid operator token", async () => {
    const res = await request("/v1/status", {}, "wrong");
    expect(res.status).toBe(401);
  });

  it("verifies operator token", async () => {
    const res = await request("/v1/auth/verify", { method: "POST" }, OP());
    expect(res.status).toBe(200);
  });
});

describe("status zero-node mode", () => {
  it("reports online control plane with zero nodes", async () => {
    const res = await request("/v1/status", {}, OP());
    expect(res.status).toBe(200);
    const body = await res.json<{
      controlPlane: string;
      database: string;
      nodes: unknown[];
      queuedJobs: number;
    }>();
    expect(body.controlPlane).toBe("ONLINE");
    expect(body.database).toBe("ONLINE");
    expect(body.nodes).toEqual([]);
    expect(body.queuedJobs).toBe(0);
  });
});

describe("nodes", () => {
  it("registers a node and accepts heartbeats", async () => {
    const reg = await request(
      "/v1/nodes/register",
      {
        method: "POST",
        body: JSON.stringify({
          name: `node-${crypto.randomUUID().slice(0, 8)}`,
          hostname: "local",
          arch: "arm64",
          cpuCount: 4,
          memoryMb: 8192,
          diskGb: 50,
          agentVersion: "0.1.0",
        }),
      },
      OP(),
    );
    expect(reg.status).toBe(201);
    const { node, token } = await reg.json<{
      node: { id: string; status: string };
      token: string;
    }>();
    expect(node.status).toBe("ONLINE");
    expect(token).toBeTruthy();

    const hb = await request(
      "/v1/nodes/heartbeat",
      {
        method: "POST",
        body: JSON.stringify({
          hostname: "local",
          arch: "arm64",
          cpuCount: 4,
          memoryMb: 8192,
          diskGb: 50,
          agentVersion: "0.1.0",
        }),
      },
      token,
    );
    expect(hb.status).toBe(200);

    const list = await request("/v1/nodes", {}, OP());
    const listed = await list.json<{ nodes: Array<{ id: string }> }>();
    expect(listed.nodes.some((n) => n.id === node.id)).toBe(true);
  });

  it("rejects invalid node token on heartbeat", async () => {
    const res = await request(
      "/v1/nodes/heartbeat",
      {
        method: "POST",
        body: JSON.stringify({
          hostname: "x",
          arch: "arm64",
          cpuCount: 1,
          memoryMb: 1,
          diskGb: 1,
          agentVersion: "0.1.0",
        }),
      },
      "not-a-real-token",
    );
    expect(res.status).toBe(401);
  });

  it("marks nodes offline after heartbeat timeout", async () => {
    const name = `stale-${crypto.randomUUID().slice(0, 8)}`;
    const reg = await request(
      "/v1/nodes/register",
      {
        method: "POST",
        body: JSON.stringify({ name, agentVersion: "0.1.0" }),
      },
      OP(),
    );
    const { node } = await reg.json<{ node: { id: string } }>();

    // Force an old heartbeat directly in D1
    await env.DB.prepare(
      `UPDATE nodes SET last_heartbeat_at = ?, status = 'ONLINE' WHERE id = ?`,
    )
      .bind(Date.now() - 60_000, node.id)
      .run();

    const status = await request("/v1/status", {}, OP());
    const body = await status.json<{
      nodes: Array<{ id: string; status: string }>;
    }>();
    const found = body.nodes.find((n) => n.id === node.id);
    expect(found?.status).toBe("OFFLINE");
  });
});

describe("jobs", () => {
  it("queues jobs when no nodes are available", async () => {
    const res = await request(
      "/v1/jobs",
      {
        method: "POST",
        body: JSON.stringify({ type: "noop", payload: { message: "ping" } }),
      },
      OP(),
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ job: { status: string; type: string } }>();
    expect(body.job.status).toBe("QUEUED");
    expect(body.job.type).toBe("noop");
  });

  it("rejects invalid job types", async () => {
    const res = await request(
      "/v1/jobs",
      {
        method: "POST",
        body: JSON.stringify({ type: "shell", payload: { cmd: "rm -rf /" } }),
      },
      OP(),
    );
    expect(res.status).toBe(400);
  });

  it("dispatches, runs, and completes a job on a node", async () => {
    const reg = await request(
      "/v1/nodes/register",
      {
        method: "POST",
        body: JSON.stringify({
          name: `worker-${crypto.randomUUID().slice(0, 8)}`,
        }),
      },
      OP(),
    );
    const { token } = await reg.json<{ token: string }>();

    const created = await request(
      "/v1/jobs",
      {
        method: "POST",
        body: JSON.stringify({ type: "noop", payload: { message: "hi" } }),
      },
      OP(),
    );
    const { job } = await created.json<{ job: { id: string } }>();

    const next = await request("/v1/nodes/me/jobs/next", {}, token);
    const claimed = await next.json<{ job: { id: string; status: string } }>();
    expect(claimed.job.id).toBe(job.id);
    expect(claimed.job.status).toBe("DISPATCHED");

    const start = await request(
      `/v1/jobs/${job.id}/start`,
      { method: "POST", body: "{}" },
      token,
    );
    expect(start.status).toBe(200);

    const logs = await request(
      `/v1/jobs/${job.id}/logs`,
      {
        method: "POST",
        body: JSON.stringify({ lines: ["hello", "world"] }),
      },
      token,
    );
    expect(logs.status).toBe(200);

    const done = await request(
      `/v1/jobs/${job.id}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ result: { ok: true } }),
      },
      token,
    );
    expect(done.status).toBe(200);

    const get = await request(`/v1/jobs/${job.id}`, {}, OP());
    const final = await get.json<{ job: { status: string } }>();
    expect(final.job.status).toBe("SUCCEEDED");

    const logGet = await request(`/v1/jobs/${job.id}/logs`, {}, OP());
    const logBody = await logGet.json<{ logs: Array<{ line: string }> }>();
    expect(logBody.logs.map((l) => l.line)).toEqual(["hello", "world"]);
  });

  it("requeues jobs when a node goes offline", async () => {
    const reg = await request(
      "/v1/nodes/register",
      {
        method: "POST",
        body: JSON.stringify({
          name: `flaky-${crypto.randomUUID().slice(0, 8)}`,
        }),
      },
      OP(),
    );
    const { node, token } = await reg.json<{
      node: { id: string };
      token: string;
    }>();

    const created = await request(
      "/v1/jobs",
      {
        method: "POST",
        body: JSON.stringify({
          type: "noop",
          payload: {},
          maxAttempts: 3,
        }),
      },
      OP(),
    );
    const { job } = await created.json<{ job: { id: string } }>();

    await request("/v1/nodes/me/jobs/next", {}, token);
    await request(
      `/v1/jobs/${job.id}/start`,
      { method: "POST", body: "{}" },
      token,
    );

    await env.DB.prepare(
      `UPDATE nodes SET last_heartbeat_at = ?, status = 'ONLINE' WHERE id = ?`,
    )
      .bind(Date.now() - 60_000, node.id)
      .run();

    await request("/v1/status", {}, OP());

    const get = await request(`/v1/jobs/${job.id}`, {}, OP());
    const body = await get.json<{ job: { status: string; nodeId: string | null } }>();
    expect(body.job.status).toBe("QUEUED");
    expect(body.job.nodeId).toBeNull();
  });

  it("records job failure", async () => {
    const reg = await request(
      "/v1/nodes/register",
      {
        method: "POST",
        body: JSON.stringify({
          name: `fail-${crypto.randomUUID().slice(0, 8)}`,
        }),
      },
      OP(),
    );
    const { token } = await reg.json<{ token: string }>();
    const created = await request(
      "/v1/jobs",
      {
        method: "POST",
        body: JSON.stringify({
          type: "noop",
          maxAttempts: 1,
        }),
      },
      OP(),
    );
    const { job } = await created.json<{ job: { id: string } }>();
    await request("/v1/nodes/me/jobs/next", {}, token);
    const fail = await request(
      `/v1/jobs/${job.id}/fail`,
      {
        method: "POST",
        body: JSON.stringify({ error: "boom", retry: false }),
      },
      token,
    );
    expect(fail.status).toBe(200);
    const get = await request(`/v1/jobs/${job.id}`, {}, OP());
    const body = await get.json<{ job: { status: string } }>();
    expect(body.job.status).toBe("FAILED");
  });
});

describe("applications", () => {
  it("registers an application and queues a deploy job", async () => {
    const name = `echo-${crypto.randomUUID().slice(0, 8)}`;
    const create = await request(
      "/v1/apps",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          runtime: "docker",
          source: { type: "image", image: "hashicorp/http-echo:1.0.0" },
          compute: { memory: "128mb", cpu: 1 },
          network: { public: true },
          sleep: false,
        }),
      },
      OP(),
    );
    expect(create.status).toBe(201);

    const deploy = await request(
      `/v1/apps/${name}/deploy`,
      { method: "POST", body: "{}" },
      OP(),
    );
    expect(deploy.status).toBe(201);
    const body = await deploy.json<{
      job: { status: string; type: string };
      deployment: { status: string; publicUrl: string | null };
    }>();
    expect(body.job.status).toBe("QUEUED");
    expect(body.job.type).toBe("deploy");
    expect(body.deployment.status).toBe("PENDING");
    expect(body.deployment.publicUrl).toContain(name);
  });
});
