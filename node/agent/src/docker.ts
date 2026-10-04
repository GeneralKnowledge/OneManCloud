import type { JobRecord } from "@omc/protocol";
import { runCommand } from "./command.js";

const ALLOWED_DOCKER = new Set([
  "pull",
  "build",
  "run",
  "stop",
  "rm",
  "ps",
  "inspect",
  "logs",
]);

async function docker(
  args: string[],
  onLog: (lines: string[]) => Promise<void>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const sub = args[0];
  if (!sub || !ALLOWED_DOCKER.has(sub)) {
    throw new Error(`Docker subcommand not allowed: ${sub}`);
  }
  await onLog([`$ docker ${args.join(" ")}`]);
  const result = await runCommand("docker", args);
  if (result.stdout.trim()) await onLog(result.stdout.trim().split("\n"));
  if (result.stderr.trim()) await onLog(result.stderr.trim().split("\n"));
  if (result.code !== 0) {
    throw new Error(`docker ${sub} exited ${result.code}`);
  }
  return result;
}

export async function executeJob(
  job: JobRecord,
  onLog: (lines: string[]) => Promise<void>,
): Promise<Record<string, unknown>> {
  const payload = JSON.parse(job.payloadJson) as Record<string, unknown>;

  switch (job.type) {
    case "noop": {
      const message = String(payload.message ?? "noop");
      await onLog([`noop: ${message}`]);
      return { ok: true, message };
    }
    case "docker.pull": {
      const image = String(payload.image ?? "");
      if (!image) throw new Error("image required");
      await docker(["pull", image], onLog);
      return { image };
    }
    case "docker.stop": {
      const name = String(payload.name ?? "");
      await docker(["stop", name], onLog);
      return { name, stopped: true };
    }
    case "docker.rm": {
      const name = String(payload.name ?? "");
      await docker(["rm", "-f", name], onLog);
      return { name, removed: true };
    }
    case "docker.run": {
      return runContainer(payload, onLog);
    }
    case "docker.build": {
      const context = String(payload.context ?? ".");
      const tag = String(payload.tag ?? "omc-build:latest");
      await docker(["build", "-t", tag, context], onLog);
      return { tag };
    }
    case "deploy": {
      return deployApp(payload, onLog);
    }
    default:
      throw new Error(`Unsupported job type: ${job.type}`);
  }
}

async function runContainer(
  payload: Record<string, unknown>,
  onLog: (lines: string[]) => Promise<void>,
): Promise<Record<string, unknown>> {
  const image = String(payload.image ?? "");
  const name = String(payload.name ?? `omc-${Date.now()}`);
  const args = (payload.args as string[] | undefined) ?? [];
  if (!image) throw new Error("image required");

  await docker(["pull", image], onLog).catch(async () => {
    await onLog(["pull failed or skipped; attempting run"]);
  });
  // Best-effort cleanup of previous container with same name
  await runCommand("docker", ["rm", "-f", name]).catch(() => undefined);

  const runArgs = ["run", "-d", "--name", name, "--restart", "unless-stopped"];
  if (payload.publishPort) {
    runArgs.push("-p", String(payload.publishPort));
  } else {
    runArgs.push("-P");
  }
  runArgs.push(image, ...args);
  const result = await docker(runArgs, onLog);
  return {
    containerId: result.stdout.trim(),
    name,
    image,
  };
}

async function deployApp(
  payload: Record<string, unknown>,
  onLog: (lines: string[]) => Promise<void>,
): Promise<Record<string, unknown>> {
  const name = String(payload.name ?? "app");
  const containerName = `omc-${name}`;
  const sourceType = String(payload.sourceType ?? "");
  const sourceArgs = (payload.sourceArgs as string[] | undefined) ?? [];
  let image = String(payload.sourceImage ?? "");

  await onLog([`Deploying application ${name}`]);

  if (sourceType === "github") {
    const repo = String(payload.sourceRepo ?? "");
    if (!repo) throw new Error("sourceRepo required for github source");
    const workdir = `/tmp/omc-build-${name}`;
    await onLog([`Cloning ${repo} into ${workdir}`]);
    await runCommand("rm", ["-rf", workdir]);
    const clone = await runCommand("git", [
      "clone",
      "--depth",
      "1",
      `https://github.com/${repo}.git`,
      workdir,
    ]);
    if (clone.code !== 0) {
      throw new Error(`git clone failed: ${clone.stderr}`);
    }
    image = `omc/${name}:latest`;
    await docker(["build", "-t", image, workdir], onLog);
  } else if (sourceType === "image") {
    if (!image) throw new Error("sourceImage required");
  } else {
    throw new Error(`Unsupported source type: ${sourceType}`);
  }

  const result = await runContainer(
    {
      image,
      name: containerName,
      args: sourceArgs,
      publishPort:
        (payload.publishPort as string | undefined) ??
        (payload.containerPort
          ? `${payload.containerPort}:${payload.containerPort}`
          : undefined),
    },
    onLog,
  );

  // Discover published port for tunnel docs
  const inspect = await runCommand("docker", [
    "inspect",
    "--format",
    "{{json .NetworkSettings.Ports}}",
    containerName,
  ]);
  await onLog([`ports: ${inspect.stdout.trim()}`]);
  if (payload.publishPort || payload.containerPort) {
    await onLog([
      `Tunnel replica target: http://localhost:${String(payload.containerPort ?? payload.publishPort)}`,
    ]);
  }

  return {
    ...result,
    publicUrl: (payload.publicUrl as string | null) ?? null,
    tunnelHint:
      "Point Cloudflare Tunnel ingress for this hostname at the container's published localhost port",
  };
}
