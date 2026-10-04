import { describe, expect, it } from "vitest";
import { formatBytes } from "@omc/shared";

describe("cli helpers", () => {
  it("formats memory", () => {
    expect(formatBytes(512)).toBe("512MB");
    expect(formatBytes(2048)).toBe("2GB");
  });
});
