import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CatalogCard } from "./CatalogCard";
import type { CatalogAddon } from "../types/addon";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

import { openUrl } from "@tauri-apps/plugin-opener";

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

describe("CatalogCard basic rendering", () => {
  it("renders name, version, author, and download count", () => {
    render(
      <CatalogCard
        addon={makeAddon({
          name: "Awesome Addon",
          version: "1.2.3",
          author: "Jane",
          downloads: 12345,
        })}
        {...defaultProps}
      />
    );
    expect(screen.getByText("Awesome Addon")).toBeInTheDocument();
    expect(screen.getByText("v1.2.3")).toBeInTheDocument();
    expect(screen.getByText("by Jane")).toBeInTheDocument();
    expect(screen.getByText("12.3K downloads")).toBeInTheDocument();
  });

  it("shows LIB badge when addon is a library", () => {
    render(<CatalogCard addon={makeAddon({ is_library: true })} {...defaultProps} />);
    expect(screen.getByText("LIB")).toBeInTheDocument();
  });

  it("does not show LIB badge when addon is not a library", () => {
    render(<CatalogCard addon={makeAddon({ is_library: false })} {...defaultProps} />);
    expect(screen.queryByText("LIB")).not.toBeInTheDocument();
  });
});

describe("CatalogCard installed state", () => {
  it("shows INSTALLED badge and hides Install button when installed", () => {
    render(<CatalogCard addon={makeAddon()} {...defaultProps} installed={true} />);
    expect(screen.getByText("INSTALLED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("shows Install button and hides INSTALLED badge when not installed", () => {
    render(<CatalogCard addon={makeAddon()} {...defaultProps} installed={false} />);
    expect(screen.queryByText("INSTALLED")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });
});

describe("CatalogCard install flow", () => {
  it("calls onInstall with the addon uid when Install is clicked", async () => {
    const onInstall = vi.fn(() => Promise.resolve());
    render(
      <CatalogCard
        addon={makeAddon({ uid: "abc123" })}
        {...defaultProps}
        onInstall={onInstall}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalledWith("abc123");
  });

  it("shows 'Installing...' while the install promise is pending", async () => {
    let resolve: () => void = () => {};
    const onInstall = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(
      <CatalogCard addon={makeAddon()} {...defaultProps} onInstall={onInstall} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(screen.getByRole("button", { name: "Installing..." })).toBeInTheDocument();
    resolve();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Installing..." })).not.toBeInTheDocument();
    });
  });
});

describe("CatalogCard staleness", () => {
  const day = 24 * 60 * 60 * 1000;

  it("shows STALE badge at warning level when date is past warning threshold", () => {
    render(
      <CatalogCard
        addon={makeAddon({ date: Date.now() - 400 * day })}
        {...defaultProps}
      />
    );
    const badge = screen.getByText("STALE");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("yellow");
  });

  it("shows STALE badge at error level when date is past error threshold", () => {
    render(
      <CatalogCard
        addon={makeAddon({ date: Date.now() - 800 * day })}
        {...defaultProps}
      />
    );
    const badge = screen.getByText("STALE");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("red");
  });

  it("hides STALE badge when hideStalenessWarnings is true", () => {
    render(
      <CatalogCard
        addon={makeAddon({ date: Date.now() - 800 * day })}
        {...defaultProps}
        hideStalenessWarnings={true}
      />
    );
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  });
});

describe("CatalogCard expanded view", () => {
  it("shows monthly downloads when expanded", () => {
    render(
      <CatalogCard
        addon={makeAddon({ downloads_monthly: 2500 })}
        {...defaultProps}
      />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.getByText("Monthly: 2.5K")).toBeInTheDocument();
  });

  it("does not show monthly downloads when the value is zero", () => {
    render(
      <CatalogCard
        addon={makeAddon({ downloads_monthly: 0 })}
        {...defaultProps}
      />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.queryByText(/Monthly:/)).not.toBeInTheDocument();
  });

  it("shows ESOUI Page button and calls openUrl when file_info_url is provided", () => {
    render(
      <CatalogCard
        addon={makeAddon({ file_info_url: "https://esoui.com/downloads/info456.html" })}
        {...defaultProps}
      />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    const esouiBtn = screen.getByRole("button", { name: /ESOUI Page/ });
    fireEvent.click(esouiBtn);
    expect(openUrl).toHaveBeenCalledWith("https://esoui.com/downloads/info456.html");
  });

  it("does not show ESOUI Page button when file_info_url is null", () => {
    render(
      <CatalogCard addon={makeAddon({ file_info_url: null })} {...defaultProps} />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.queryByRole("button", { name: /ESOUI Page/ })).not.toBeInTheDocument();
  });
});
