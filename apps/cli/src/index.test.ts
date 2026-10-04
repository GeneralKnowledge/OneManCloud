import { describe, expect, it } from "vitest";
import { formatBytes } from "@omc/shared";
import type { JobRecord } from "@omc/protocol";
import { waitForJobs } from "./index";

describe("cli helpers", () => {
  it("formats memory", () => {
    expect(formatBytes(512)).toBe("512MB");
    expect(formatBytes(2048)).toBe("2GB");
  });
});

describe("waitForJobs", () => {
  it("polls until all jobs succeed and streams new log lines", async () => {
    const states: JobRecord[] = [
      {
        id: "job_a",
        type: "deploy",
        applicationId: null,
        nodeId: null,
        status: "RUNNING",
        payloadJson: "{}",
        resultJson: null,
        attempts: 1,
        maxAttempts: 3,
        createdAt: 1,
        updatedAt: 1,
        startedAt: 1,
        finishedAt: null,
      },
      {
        id: "job_a",
        type: "deploy",
        applicationId: null,
        nodeId: null,
        status: "SUCCEEDED",
        payloadJson: "{}",
        resultJson: "{}",
        attempts: 1,
        maxAttempts: 3,
        createdAt: 1,
        updatedAt: 2,
        startedAt: 1,
        finishedAt: 2,
      },
    ];
    let call = 0;
    const lines: string[] = [];
    const result = await waitForJobs(["job_a"], {
      pollMs: 1,
      fetchJob: async () => states[Math.min(call++, states.length - 1)]!,
      fetchLogs: async () =>
        call <= 1
          ? [{ seq: 1, line: "pulling" }]
          : [
              { seq: 1, line: "pulling" },
              { seq: 2, line: "done" },
            ],
      onLog: (_id, line) => lines.push(line),
    });
    expect(result.ok).toBe(true);
    expect(lines).toEqual(["pulling", "done"]);
  });

  it("returns ok=false when a job fails", async () => {
    const result = await waitForJobs(["job_b"], {
      pollMs: 1,
      fetchJob: async () =>
        ({
          id: "job_b",
          type: "deploy",
          applicationId: null,
          nodeId: null,
          status: "FAILED",
          payloadJson: "{}",
          resultJson: "{}",
          attempts: 1,
          maxAttempts: 3,
          createdAt: 1,
          updatedAt: 1,
          startedAt: 1,
          finishedAt: 1,
        }) satisfies JobRecord,
      fetchLogs: async () => [],
    });
    expect(result.ok).toBe(false);
  });
});
