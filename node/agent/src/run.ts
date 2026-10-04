import { cpus, freemem, hostname, totalmem } from "node:os";
import { mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  defaultConfigPath,
  defaultNodeStatePath,
} from "@omc/config";
import { AGENT_VERSION, type JobRecord } from "@omc/protocol";
import { executeJob, listRunningOmcContainers } from "./docker.js";

export interface NodeState {
  nodeId: string;
  name: string;
  token: string;
  url: string;
}

export interface AgentOptions {
  name: string;
  once?: boolean;
  url?: string;
  /** Only for local operator machine (`omc node local`). Never on remote VMs. */
  operatorToken?: string;
  nodeToken?: string;
}

async function loadOperatorConfig(): Promise<{ url: string; token: string }> {
  const path = defaultConfigPath();
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as { url: string; token: string };
}

async function loadNodeState(): Promise<NodeState | null> {
  try {
    const raw = await readFile(defaultNodeStatePath(), "utf8");
    return JSON.parse(raw) as NodeState;
  } catch {
    return null;
  }
}

async function saveNodeState(state: NodeState): Promise<void> {
  const path = defaultNodeStatePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
  });
}

async function hostMetrics(): Promise<{
  hostname: string;
  arch: string;
  cpuCount: number;
  memoryMb: number;
  diskGb: number;
}> {
  let diskGb = 0;
  try {
    const fsStat = await statfs("/");
    diskGb = Math.round(
      (Number(fsStat.bavail) * Number(fsStat.bsize)) / (1024 * 1024 * 1024),
    );
  } catch {
    diskGb = 0;
  }
  return {
    hostname: hostname(),
    arch: process.arch,
    cpuCount: cpus().length,
    memoryMb: Math.round(totalmem() / (1024 * 1024)),
    diskGb,
  };
}

async function api(
  state: { url: string; token: string },
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${state.url.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Bootstrap node state.
 * Prefer OMC_NODE_TOKEN + OMC_URL (remote nodes).
 * Operator registration is allowed only when operatorToken is explicitly provided
 * (local `omc node local` path).
 */
async function ensureRegistered(opts: AgentOptions): Promise<NodeState> {
  const existing = await loadNodeState();
  if (existing && (!opts.nodeToken || existing.token === opts.nodeToken)) {
    if (opts.url && existing.url !== opts.url) {
      existing.url = opts.url;
      await saveNodeState(existing);
    }
    return existing;
  }

  // Resolve identity from a pre-issued node token (remote installer path).
  if (opts.nodeToken && opts.url) {
    const res = await api(
      { url: opts.url, token: opts.nodeToken },
      "GET",
      "/v1/nodes/me",
    );
    if (!res.ok) {
      throw new Error(
        `node token invalid (${res.status}). Register from laptop: omc node register --name ${opts.name}`,
      );
    }
    const body = (await res.json()) as {
      node: { id: string; name: string };
    };
    const state: NodeState = {
      nodeId: body.node.id,
      name: body.node.name,
      token: opts.nodeToken,
      url: opts.url,
    };
    await saveNodeState(state);
    console.log(`Joined as ${state.name} (${state.nodeId}) via node token`);
    return state;
  }

  // Local-only: register with operator credentials from ~/.omc or explicit opts.
  if (!opts.operatorToken && !opts.url) {
    // Try local operator config for `omc node local`.
    try {
      const op = await loadOperatorConfig();
      const metrics = await hostMetrics();
      const res = await api(op, "POST", "/v1/nodes/register", {
        name: opts.name,
        ...metrics,
        agentVersion: AGENT_VERSION,
      });
      if (!res.ok) {
        throw new Error(`register failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as {
        node: { id: string; name: string };
        token: string;
      };
      const state: NodeState = {
        nodeId: body.node.id,
        name: body.node.name,
        token: body.token,
        url: op.url,
      };
      await saveNodeState(state);
      console.log(`Registered as ${state.name} (${state.nodeId})`);
      return state;
    } catch (err) {
      throw new Error(
        `Cannot start agent without node state. On a remote node set OMC_URL and OMC_NODE_TOKEN ` +
          `(register first with: omc node register --name ${opts.name}). ` +
          `Detail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (opts.url && opts.operatorToken) {
    const op = { url: opts.url, token: opts.operatorToken };
    const metrics = await hostMetrics();
    const res = await api(op, "POST", "/v1/nodes/register", {
      name: opts.name,
      ...metrics,
      agentVersion: AGENT_VERSION,
    });
    if (!res.ok) {
      throw new Error(`register failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as {
      node: { id: string; name: string };
      token: string;
    };
    const state: NodeState = {
      nodeId: body.node.id,
      name: body.node.name,
      token: body.token,
      url: op.url,
    };
    await saveNodeState(state);
    console.log(`Registered as ${state.name} (${state.nodeId})`);
    return state;
  }

  throw new Error(
    `Missing credentials. Set OMC_URL + OMC_NODE_TOKEN, or run 'omc node local' on the operator machine.`,
  );
}

async function heartbeat(state: NodeState): Promise<void> {
  const metrics = await hostMetrics();
  const runningApplications = await listRunningOmcContainers();
  const res = await api(state, "POST", "/v1/nodes/heartbeat", {
    ...metrics,
    agentVersion: AGENT_VERSION,
    runningApplications,
  });
  if (!res.ok) {
    throw new Error(`heartbeat failed: ${res.status}`);
  }
}

async function pollAndRun(state: NodeState): Promise<boolean> {
  const res = await api(state, "GET", "/v1/nodes/me/jobs/next");
  if (!res.ok) {
    throw new Error(`poll failed: ${res.status}`);
  }
  const body = (await res.json()) as { job: JobRecord | null };
  if (!body.job) return false;

  const job = body.job;
  console.log(`Claimed job ${job.id} (${job.type})`);
  await api(state, "POST", `/v1/jobs/${job.id}/start`, {});

  try {
    const result = await executeJob(job, async (lines) => {
      await api(state, "POST", `/v1/jobs/${job.id}/logs`, { lines });
    });
    await api(state, "POST", `/v1/jobs/${job.id}/complete`, { result });
    console.log(`Job ${job.id} succeeded`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await api(state, "POST", `/v1/jobs/${job.id}/logs`, {
      lines: [`ERROR: ${message}`],
    });
    await api(state, "POST", `/v1/jobs/${job.id}/fail`, {
      error: message,
      retry: true,
    });
    console.error(`Job ${job.id} failed: ${message}`);
  }
  return true;
}

export async function runAgent(opts: AgentOptions): Promise<void> {
  let state = await ensureRegistered(opts);
  console.log(
    `Agent starting (${AGENT_VERSION}) freeMem=${Math.round(freemem() / (1024 * 1024))}MB`,
  );

  const tick = async () => {
    try {
      await heartbeat(state);
      await pollAndRun(state);
    } catch (err) {
      console.error(
        "agent loop error:",
        err instanceof Error ? err.message : err,
      );
      // Do not re-register with operator token on remote hosts.
      // If node token was revoked, operator must re-register and refresh OMC_NODE_TOKEN.
    }
  };

  await tick();
  if (opts.once) return;

  setInterval(() => {
    void heartbeat(state).catch((err) =>
      console.error("heartbeat error", err),
    );
  }, DEFAULT_HEARTBEAT_INTERVAL_MS);

  setInterval(() => {
    void pollAndRun(state).catch((err) => console.error("poll error", err));
  }, DEFAULT_POLL_INTERVAL_MS);

  await new Promise(() => undefined);
}
