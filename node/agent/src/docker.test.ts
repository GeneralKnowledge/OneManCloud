import { describe, expect, it } from "vitest";
import { buildRunArgs, executeJob } from "./docker";
import type { JobRecord } from "@omc/protocol";

function job(type: JobRecord["type"], payload: Record<string, unknown>): JobRecord {
  return {
    id: "job_test",
    type,
    applicationId: null,
    nodeId: null,
    status: "RUNNING",
    payloadJson: JSON.stringify(payload),
    resultJson: null,
    attempts: 1,
    maxAttempts: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: null,
  };
}

describe("executeJob", () => {
  it("handles noop", async () => {
    const lines: string[] = [];
    const result = await executeJob(job("noop", { message: "hi" }), async (l) => {
      lines.push(...l);
    });
    expect(result).toEqual({ ok: true, message: "hi" });
    expect(lines[0]).toContain("noop: hi");
  });

  it("rejects unknown docker subcommands via type surface", async () => {
    await expect(
      executeJob(job("docker.pull", {}), async () => undefined),
    ).rejects.toThrow(/image required/);
  });
});

describe("buildRunArgs", () => {
  it("includes memory, cpus, and env flags", () => {
    const args = buildRunArgs({
      image: "hashicorp/http-echo:1.0.0",
      name: "omc-http-echo",
      publishPort: "5678:5678",
      memoryMb: 128,
      cpu: 1,
      env: { GREETING: "hi", FLAG: "1" },
      args: ["-listen=:5678"],
    });
    expect(args).toEqual([
      "run",
      "-d",
      "--name",
      "omc-http-echo",
      "--restart",
      "unless-stopped",
      "-p",
      "5678:5678",
      "--memory",
      "128m",
      "--cpus",
      "1",
      "-e",
      "GREETING=hi",
      "-e",
      "FLAG=1",
      "hashicorp/http-echo:1.0.0",
      "-listen=:5678",
    ]);
  });
});
