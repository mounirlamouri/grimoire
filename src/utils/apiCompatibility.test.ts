import { describe, it, expect } from "vitest";
import { getApiCompatibility, formatUpdateLabel } from "./apiCompatibility";

describe("getApiCompatibility", () => {
  it("returns unknown when currentApiVersion is null", () => {
    expect(getApiCompatibility([101049], null)).toBe("unknown");
  });

  it("returns unknown when currentApiVersion is undefined", () => {
    expect(getApiCompatibility([101049], undefined)).toBe("unknown");
  });

  it("returns unknown when addon has no declared api versions", () => {
    expect(getApiCompatibility([], 101049)).toBe("unknown");
    expect(getApiCompatibility(null, 101049)).toBe("unknown");
    expect(getApiCompatibility(undefined, 101049)).toBe("unknown");
  });

  it("returns compatible when addon targets the current version", () => {
    expect(getApiCompatibility([101049], 101049)).toBe("compatible");
  });

  it("returns compatible when addon targets a newer version than current", () => {
    expect(getApiCompatibility([101050], 101049)).toBe("compatible");
  });

  it("returns compatible when any declared version is >= current", () => {
    expect(getApiCompatibility([101047, 101049], 101049)).toBe("compatible");
  });

  it("returns outdated when all declared versions are older than current", () => {
    expect(getApiCompatibility([101047, 101048], 101049)).toBe("outdated");
  });
});

describe("formatUpdateLabel", () => {
  it("extracts the last three digits as U<n>", () => {
    expect(formatUpdateLabel(101049)).toBe("U49");
    expect(formatUpdateLabel(101047)).toBe("U47");
    expect(formatUpdateLabel(101050)).toBe("U50");
  });
});
