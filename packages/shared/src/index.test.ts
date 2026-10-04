import { describe, expect, it } from "vitest";
import { parseMemoryMb, sha256Hex, timingSafeEqual } from "./index";

describe("sha256Hex", () => {
  it("hashes deterministically", async () => {
    const a = await sha256Hex("token");
    const b = await sha256Hex("token");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});

describe("timingSafeEqual", () => {
  it("returns true for equal strings", async () => {
    expect(await timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("returns false for unequal strings", async () => {
    expect(await timingSafeEqual("abc", "abd")).toBe(false);
    expect(await timingSafeEqual("abc", "ab")).toBe(false);
  });
});

describe("parseMemoryMb", () => {
  it("parses mb and gb", () => {
    expect(parseMemoryMb("512mb")).toBe(512);
    expect(parseMemoryMb("1gb")).toBe(1024);
    expect(parseMemoryMb(256)).toBe(256);
  });
});
