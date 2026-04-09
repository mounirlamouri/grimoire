import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AddonCard } from "./AddonCard";
import type { InstalledAddon } from "../types/addon";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
  revealItemInDir: vi.fn(() => Promise.resolve()),
}));

import { revealItemInDir } from "@tauri-apps/plugin-opener";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeAddon(overrides: Partial<InstalledAddon> = {}): InstalledAddon {
  return {
    dir_name: "TestAddon",
    title: "Test Addon",
    author: "Author",
    version: "1.0",
    addon_version: null,
    api_versions: [],
    depends_on: [],
    optional_depends_on: [],
    is_library: false,
    description: "",
    ...overrides,
  };
}

const defaultProps = {
  stalenessWarningDays: 365,
  stalenessErrorDays: 730,
  hideStalenessWarnings: false,
  onUninstall: vi.fn(() => Promise.resolve()),
  onUpdate: vi.fn(() => Promise.resolve()),
  onFixDeps: vi.fn(() => Promise.resolve()),
};

describe("AddonCard folder link", () => {
  it("shows dir_name as plain text when addonPath is not provided", () => {
    render(<AddonCard addon={makeAddon()} {...defaultProps} />);
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.getByText("TestAddon")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open.*folder/i })).toBeNull();
  });

  it("shows dir_name as clickable button with folder icon when addonPath is provided", () => {
    render(<AddonCard addon={makeAddon()} addonPath="C:/AddOns" {...defaultProps} />);
    fireEvent.click(screen.getByText("Test Addon"));
    const folderBtn = screen.getByRole("button", { name: "Open TestAddon folder" });
    expect(folderBtn).toBeTruthy();
    expect(folderBtn.textContent).toContain("TestAddon");
  });

  it("calls revealItemInDir with correct path when folder button is clicked", () => {
    render(<AddonCard addon={makeAddon({ dir_name: "MyAddon" })} addonPath="C:/Users/test/AddOns" {...defaultProps} />);
    fireEvent.click(screen.getByText("Test Addon"));
    const folderBtn = screen.getByRole("button", { name: "Open MyAddon folder" });
    fireEvent.click(folderBtn);
    expect(revealItemInDir).toHaveBeenCalledWith("C:/Users/test/AddOns/MyAddon");
  });

  it("shows dir_name as plain text when addonPath is null", () => {
    render(<AddonCard addon={makeAddon()} addonPath={null} {...defaultProps} />);
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.getByText("TestAddon")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open.*folder/i })).toBeNull();
  });
});
