import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getStaleness } from "./staleness";

const DAY_MS = 1000 * 60 * 60 * 24;

// Pin Date.now() so tests don't depend on the real clock
const NOW = new Date("2025-01-01T00:00:00Z").getTime();

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getStaleness", () => {
  describe("null / missing date", () => {
    it("returns null when catalogDate is null", () => {
      expect(getStaleness(null, 180, 365)).toBe(null);
    });

    it("returns null when catalogDate is undefined", () => {
      expect(getStaleness(undefined, 180, 365)).toBe(null);
    });
  });

  describe("recent addon (under warning threshold)", () => {
    it("returns null when updated today", () => {
      expect(getStaleness(NOW, 180, 365)).toBe(null);
    });

    it("returns null when updated 1 day ago", () => {
      expect(getStaleness(NOW - DAY_MS, 180, 365)).toBe(null);
    });

    it("returns null just below the warning threshold", () => {
      expect(getStaleness(NOW - 179 * DAY_MS, 180, 365)).toBe(null);
    });
  });

  describe("warning level (between warning and error thresholds)", () => {
    it("returns warning exactly at the warning threshold", () => {
      expect(getStaleness(NOW - 180 * DAY_MS, 180, 365)).toBe("warning");
    });

    it("returns warning past the warning threshold", () => {
      expect(getStaleness(NOW - 200 * DAY_MS, 180, 365)).toBe("warning");
    });

    it("returns warning just below the error threshold", () => {
      expect(getStaleness(NOW - 364 * DAY_MS, 180, 365)).toBe("warning");
    });
  });

  describe("error level (at or above error threshold)", () => {
    it("returns error exactly at the error threshold", () => {
      expect(getStaleness(NOW - 365 * DAY_MS, 180, 365)).toBe("error");
    });

    it("returns error well past the error threshold", () => {
      expect(getStaleness(NOW - 730 * DAY_MS, 180, 365)).toBe("error");
    });
  });

  describe("custom thresholds", () => {
    it("respects a custom warning threshold of 30 days", () => {
      expect(getStaleness(NOW - 29 * DAY_MS, 30, 60)).toBe(null);
      expect(getStaleness(NOW - 30 * DAY_MS, 30, 60)).toBe("warning");
    });

    it("respects a custom error threshold of 60 days", () => {
      expect(getStaleness(NOW - 59 * DAY_MS, 30, 60)).toBe("warning");
      expect(getStaleness(NOW - 60 * DAY_MS, 30, 60)).toBe("error");
    });

    it("handles equal warning and error thresholds (jumps straight to error)", () => {
      expect(getStaleness(NOW - 90 * DAY_MS, 90, 90)).toBe("error");
      expect(getStaleness(NOW - 89 * DAY_MS, 90, 90)).toBe(null);
    });
  });
});
