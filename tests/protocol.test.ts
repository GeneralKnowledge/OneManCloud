import { describe, expect, it } from "vitest";
import { JOB_STATUSES, JOB_TYPES, NODE_STATUSES } from "@omc/protocol";

describe("protocol contracts", () => {
  it("exposes explicit node and job statuses", () => {
    expect(NODE_STATUSES).toEqual(["ONLINE", "OFFLINE", "DISABLED"]);
    expect(JOB_STATUSES).toContain("QUEUED");
    expect(JOB_STATUSES).toContain("SUCCEEDED");
    expect(JOB_STATUSES).not.toContain("CANCELLED");
  });

  it("includes docker.logs for app log jobs", () => {
    expect(JOB_TYPES).toContain("docker.logs");
    expect(JOB_TYPES).toContain("deploy");
  });
});
