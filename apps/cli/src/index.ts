import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  defaultConfigPath,
  type OmcClientConfig,
} from "@omc/config";
import { formatBytes } from "@omc/shared";
import type {
  ApplicationConfig,
  JobRecord,
  NodeRecord,
  StatusResponse,
} from "@omc/protocol";
import { parse as parseYaml } from "yaml";

async function loadConfig(): Promise<OmcClientConfig> {
  const path = defaultConfigPath();
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as OmcClientConfig;
  } catch {
    throw new Error(
      `Not logged in. Run: omc login --url <control-plane-url>\n(Looked for ${path})`,
    );
  }
}

async function saveConfig(config: OmcClientConfig): Promise<void> {
  const path = defaultConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  config?: OmcClientConfig,
): Promise<T> {
  const cfg = config ?? (await loadConfig());
  const res = await fetch(`${cfg.url.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      ...(body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { error: text };
  }
  if (!res.ok) {
    const err = (json as { error?: string } | null)?.error ?? res.statusText;
    throw new Error(`${method} ${path} failed (${res.status}): ${err}`);
  }
  return json as T;
}

function flag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function has(args: string[], name: string): boolean {
  return args.includes(name);
}

async function cmdLogin(args: string[]): Promise<void> {
  const url =
    flag(args, "--url") ?? process.env.OMC_URL ?? "http://127.0.0.1:8787";
  let token = flag(args, "--token") ?? process.env.OPERATOR_TOKEN;
  if (!token) {
    const rl = createInterface({ input, output });
    token = await rl.question("Operator token: ");
    rl.close();
  }
  token = token.trim();
  if (!token) throw new Error("Token required");

  await api("POST", "/v1/auth/verify", {}, { url, token });
  await saveConfig({ url, token });
  console.log(`Logged in to ${url}`);
  console.log(`Config written to ${defaultConfigPath()}`);
}

async function cmdStatus(): Promise<void> {
  const status = await api<StatusResponse>("GET", "/v1/status");
  console.log(status.name);
  console.log(`Control Plane    ${status.controlPlane}`);
  console.log(`Database         ${status.database}`);
  console.log("Nodes");
  if (status.nodes.length === 0) {
    console.log("  (none)");
  } else {
    for (const n of status.nodes) {
      const cpu = n.cpuCount != null ? `${n.cpuCount} CPU` : "-";
      const mem = formatBytes(n.memoryMb);
      console.log(
        `  ${n.name.padEnd(14)} ${n.status.padEnd(10)} ${cpu.padEnd(8)} ${mem}`,
      );
    }
  }
  console.log("Applications");
  if (status.applications.length === 0) {
    console.log("  (none)");
  } else {
    for (const a of status.applications) {
      console.log(`  ${a.name.padEnd(14)} ${a.status}`);
    }
  }
  console.log(`Queued Jobs      ${status.queuedJobs}`);
}

async function cmdNodes(): Promise<void> {
  const body = await api<{ nodes: NodeRecord[] }>("GET", "/v1/nodes");
  console.log(
    "NAME".padEnd(14) +
      "STATUS".padEnd(10) +
      "ARCH".padEnd(8) +
      "CPU".padEnd(6) +
      "MEMORY",
  );
  for (const n of body.nodes) {
    console.log(
      `${n.name.padEnd(14)}${n.status.padEnd(10)}${(n.arch ?? "-").padEnd(8)}${String(n.cpuCount ?? "-").padEnd(6)}${formatBytes(n.memoryMb)}`,
    );
  }
  if (body.nodes.length === 0) {
    console.log("(no nodes registered)");
  }
}

async function cmdNodeRegister(args: string[]): Promise<void> {
  const name =
    flag(args, "--name") ?? `node-${crypto.randomUUID().slice(0, 8)}`;
  const body = await api<{ node: NodeRecord; token: string }>(
    "POST",
    "/v1/nodes/register",
    {
      name,
      hostname: flag(args, "--hostname"),
      arch: flag(args, "--arch"),
      agentVersion: "0.1.0",
    },
  );
  console.log(`Registered node ${body.node.name} (${body.node.id})`);
  console.log(`Node token (save now, shown once):`);
  console.log(body.token);
}

async function cmdNodeStatus(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) throw new Error("Usage: omc node status <id>");
  const body = await api<{ node: NodeRecord }>("GET", `/v1/nodes/${id}`);
  console.log(JSON.stringify(body.node, null, 2));
}

async function cmdApps(): Promise<void> {
  const body = await api<{
    applications: Array<{ name: string; runtime: string; public: boolean }>;
  }>("GET", "/v1/apps");
  for (const app of body.applications) {
    console.log(
      `${app.name.padEnd(20)} ${app.runtime.padEnd(10)} public=${app.public}`,
    );
  }
  if (body.applications.length === 0) console.log("(no applications)");
}

async function cmdAppRegister(args: string[]): Promise<void> {
  const file = flag(args, "--file");
  if (!file) throw new Error("Usage: omc apps register --file <path>");
  const raw = await readFile(file, "utf8");
  const config = (
    file.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw)
  ) as ApplicationConfig;
  const body = await api<{ application: { name: string; id: string } }>(
    "POST",
    "/v1/apps",
    config,
  );
  console.log(`Registered application ${body.application.name}`);
}

async function cmdDeploy(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) throw new Error("Usage: omc deploy <app-name>");
  const body = await api<{
    mode?: string;
    targetNodes?: number;
    publicUrl?: string | null;
    publishPort?: string;
    tunnelHint?: string;
    deployment: { id: string; status: string; publicUrl: string | null };
    job: JobRecord;
    deployments?: Array<{ id: string; status: string; nodeId: string | null }>;
    jobs?: JobRecord[];
  }>("POST", `/v1/apps/${name}/deploy`, {});
  console.log(`Mode       ${body.mode ?? "single"}`);
  console.log(`Targets    ${body.targetNodes ?? 1} ONLINE node(s)`);
  for (const dep of body.deployments ?? [body.deployment]) {
    console.log(
      `Deployment ${dep.id}  ${dep.status}  node=${"nodeId" in dep ? dep.nodeId ?? "(any)" : "-"}`,
    );
  }
  for (const job of body.jobs ?? [body.job]) {
    console.log(`Job        ${job.id}  ${job.status}  node=${job.nodeId ?? "(any)"}`);
  }
  if (body.publishPort) {
    console.log(`Publish    ${body.publishPort}`);
  }
  const url = body.publicUrl ?? body.deployment.publicUrl;
  if (url) {
    console.log(`Public URL ${url}`);
  }
  if (body.tunnelHint) {
    console.log(body.tunnelHint);
  } else {
    console.log(
      "(Expose via Cloudflare Tunnel replicas — see omc tunnel / docs/tunnel.md)",
    );
  }
}

async function cmdJobs(args: string[]): Promise<void> {
  if (args[0] === "create") {
    const type = flag(args, "--type") ?? "noop";
    const payloadRaw = flag(args, "--payload") ?? "{}";
    const body = await api<{ job: JobRecord }>("POST", "/v1/jobs", {
      type,
      payload: JSON.parse(payloadRaw),
    });
    console.log(`${body.job.id}  ${body.job.status}  ${body.job.type}`);
    return;
  }
  if (args[0] === "show") {
    const id = args[1];
    if (!id) throw new Error("Usage: omc jobs show <id>");
    const body = await api<{ job: JobRecord }>("GET", `/v1/jobs/${id}`);
    console.log(JSON.stringify(body.job, null, 2));
    return;
  }
  const body = await api<{ jobs: JobRecord[] }>("GET", "/v1/jobs");
  for (const job of body.jobs) {
    console.log(
      `${job.id}  ${job.status.padEnd(10)} ${job.type.padEnd(12)} attempts=${job.attempts}`,
    );
  }
  if (body.jobs.length === 0) console.log("(no jobs)");
}

async function cmdLogs(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) throw new Error("Usage: omc logs <job-id>");
  const body = await api<{ logs: Array<{ seq: number; line: string }> }>(
    "GET",
    `/v1/jobs/${id}/logs`,
  );
  for (const line of body.logs) {
    console.log(line.line);
  }
  if (body.logs.length === 0) console.log("(no logs)");
}

async function cmdTunnel(): Promise<void> {
  const body = await api<{ model: Record<string, unknown> }>(
    "GET",
    "/v1/tunnel",
  );
  console.log(JSON.stringify(body.model, null, 2));
}

async function cmdConfig(args: string[]): Promise<void> {
  if (args[0] === "set") {
    const key = args[1];
    const value = args[2];
    if (!key || value === undefined) {
      throw new Error("Usage: omc config set <key> <value>");
    }
    await api("PUT", `/v1/config/${encodeURIComponent(key)}`, { value });
    console.log(`Set ${key}`);
    return;
  }
  const body = await api<{ config: Record<string, string> }>(
    "GET",
    "/v1/config",
  );
  for (const [k, v] of Object.entries(body.config)) {
    console.log(`${k}=${v}`);
  }
}

async function cmdNodeLocal(args: string[]): Promise<void> {
  const { runAgent } = await import("@omc/agent/run");
  const name = flag(args, "--name") ?? "local";
  await runAgent({
    name,
    once: has(args, "--once"),
  });
}

function usage(): never {
  console.log(`OneManCloud CLI (omc)

Usage:
  omc login [--url URL] [--token TOKEN]
  omc status
  omc nodes
  omc node register [--name NAME]
  omc node status <id>
  omc node local [--name NAME] [--once]
  omc apps
  omc apps register --file <path>
  omc deploy <app>
  omc jobs
  omc jobs create --type noop [--payload JSON]
  omc jobs show <id>
  omc logs <job-id>
  omc tunnel
  omc config
  omc config set <key> <value>
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "help" || cmd === "--help") usage();

  switch (cmd) {
    case "login":
      await cmdLogin(rest);
      break;
    case "status":
      await cmdStatus();
      break;
    case "nodes":
      await cmdNodes();
      break;
    case "node":
      if (rest[0] === "register") await cmdNodeRegister(rest.slice(1));
      else if (rest[0] === "status") await cmdNodeStatus(rest.slice(1));
      else if (rest[0] === "local") await cmdNodeLocal(rest.slice(1));
      else usage();
      break;
    case "apps":
      if (rest[0] === "register") await cmdAppRegister(rest.slice(1));
      else await cmdApps();
      break;
    case "deploy":
      await cmdDeploy(rest);
      break;
    case "jobs":
      await cmdJobs(rest);
      break;
    case "logs":
      await cmdLogs(rest);
      break;
    case "tunnel":
      await cmdTunnel();
      break;
    case "config":
      await cmdConfig(rest);
      break;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
