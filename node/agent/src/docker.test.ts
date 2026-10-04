import { describe, expect, it } from "vitest";
import { executeJob } from "./docker";
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
    // shell is not a JobType; invalid payloads for docker.pull fail clearly
    await expect(
      executeJob(job("docker.pull", {}), async () => undefined),
    ).rejects.toThrow(/image required/);
  });
});
