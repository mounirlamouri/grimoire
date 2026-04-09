import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatRelativeDate } from "./formatDate";

const DAY_MS = 1000 * 60 * 60 * 24;
const NOW = new Date("2025-01-01T00:00:00Z").getTime();

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatRelativeDate", () => {
  it("returns 'today' for a timestamp from today", () => {
    expect(formatRelativeDate(NOW)).toBe("today");
    expect(formatRelativeDate(NOW - 1000)).toBe("today"); // a second ago
  });

  it("returns 'yesterday' for 1 day ago", () => {
    expect(formatRelativeDate(NOW - DAY_MS)).toBe("yesterday");
  });

  it("returns 'N days ago' for 2–29 days", () => {
    expect(formatRelativeDate(NOW - 2 * DAY_MS)).toBe("2 days ago");
    expect(formatRelativeDate(NOW - 15 * DAY_MS)).toBe("15 days ago");
    expect(formatRelativeDate(NOW - 29 * DAY_MS)).toBe("29 days ago");
  });

  it("returns '1 month ago' at 30 days", () => {
    expect(formatRelativeDate(NOW - 30 * DAY_MS)).toBe("1 month ago");
  });

  it("returns 'N months ago' for 2–11 months", () => {
    expect(formatRelativeDate(NOW - 60 * DAY_MS)).toBe("2 months ago");
    expect(formatRelativeDate(NOW - 180 * DAY_MS)).toBe("6 months ago");
    expect(formatRelativeDate(NOW - 330 * DAY_MS)).toBe("11 months ago");
  });

  it("returns '1 year ago' at 12 months", () => {
    expect(formatRelativeDate(NOW - 360 * DAY_MS)).toBe("1 year ago");
  });

  it("returns '1 year, N mo ago' for 13–23 months", () => {
    expect(formatRelativeDate(NOW - 390 * DAY_MS)).toBe("1 year, 1 mo ago");
    expect(formatRelativeDate(NOW - 540 * DAY_MS)).toBe("1 year, 6 mo ago");
  });

  it("returns 'N years ago' for exact multi-year spans", () => {
    expect(formatRelativeDate(NOW - 720 * DAY_MS)).toBe("2 years ago");
  });

  it("returns 'N years, M mo ago' for years with remaining months", () => {
    expect(formatRelativeDate(NOW - 750 * DAY_MS)).toBe("2 years, 1 mo ago");
    expect(formatRelativeDate(NOW - 900 * DAY_MS)).toBe("2 years, 6 mo ago");
  });

  it("returns 'just now' for future timestamps", () => {
    expect(formatRelativeDate(NOW + DAY_MS)).toBe("just now");
  });
});
