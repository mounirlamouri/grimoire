import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CatalogCard } from "./CatalogCard";
import type { CatalogAddon } from "../types/addon";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

afterEach(() => {
  cleanup();
});

function makeAddon(overrides: Partial<CatalogAddon> = {}): CatalogAddon {
  return {
    uid: "1",
    name: "Test Catalog Addon",
    version: "2.0",
    date: Date.now(),
    downloads: 1000,
    favorites: 50,
    downloads_monthly: 100,
    directories: "TestDir1,TestDir2",
    category_id: null,
    author: "Author",
    download_url: null,
    file_info_url: null,
    is_library: false,
    ...overrides,
  };
}

const defaultProps = {
  installed: false,
  stalenessWarningDays: 365,
  stalenessErrorDays: 730,
  hideStalenessWarnings: false,
  onInstall: vi.fn(() => Promise.resolve()),
};

describe("CatalogCard directories", () => {
  it("does not show directories in expanded view", () => {
    render(<CatalogCard addon={makeAddon({ directories: "DirA,DirB,DirC" })} {...defaultProps} />);
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.queryByText(/DirA/)).toBeNull();
    expect(screen.queryByText(/DirB/)).toBeNull();
    expect(screen.queryByText(/Folders/i)).toBeNull();
  });

  it("does not show directories even for single directory addon", () => {
    render(<CatalogCard addon={makeAddon({ directories: "SingleDir" })} {...defaultProps} />);
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.queryByText("SingleDir")).toBeNull();
    expect(screen.queryByText(/Folder/i)).toBeNull();
  });
});
