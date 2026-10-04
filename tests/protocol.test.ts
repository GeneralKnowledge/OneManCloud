import { describe, expect, it } from "vitest";
import { JOB_STATUSES, NODE_STATUSES } from "@omc/protocol";
import { LocalNodeProvider, OracleNodeProvider } from "@omc/protocol";

describe("protocol contracts", () => {
  it("exposes explicit node and job statuses", () => {
    expect(NODE_STATUSES).toContain("ONLINE");
    expect(NODE_STATUSES).toContain("OFFLINE");
    expect(JOB_STATUSES).toContain("QUEUED");
    expect(JOB_STATUSES).toContain("SUCCEEDED");
  });

  it("defines compute providers without coupling to Oracle APIs", () => {
    expect(OracleNodeProvider.kind).toBe("oracle");
    expect(LocalNodeProvider.kind).toBe("local");
  });
});
