import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Force @bbob/react to throw on render so we can verify the error boundary
// falls back to plain text. Kept in a separate file because this mock would
// break every other render in the main BBCode test suite.
vi.mock("@bbob/react", () => ({
  default: () => {
    throw new Error("simulated BBCode render failure");
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
  revealItemInDir: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { BBCodeDescription } from "./BBCodeDescription";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BBCodeDescription error boundary", () => {
  it("renders the raw text in a fallback <p> when BBCode rendering throws", () => {
    // The boundary calls console.error internally; silence it to keep output clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<BBCodeDescription text="raw fallback content" />);

    const para = screen.getByText("raw fallback content");
    expect(para.tagName).toBe("P");
    expect(para.className).toMatch(/whitespace-pre-wrap/);

    spy.mockRestore();
  });
});
