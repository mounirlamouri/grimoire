import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CatalogCard } from "./CatalogCard";
import type { CatalogAddon, AddonMetadata } from "../types/addon";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { openUrl } from "@tauri-apps/plugin-opener";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

function makeMetadata(overrides: Partial<AddonMetadata> = {}): AddonMetadata {
  return {
    uid: "1",
    description: null,
    compatibility: null,
    donation_link: null,
    img_thumbs: null,
    imgs: null,
    siblings: null,
    ui_date: null,
    fetched_at: 0,
    ...overrides,
  };
}

describe("CatalogCard metadata rendering", () => {
  it("shows description from metadata when metadata is available and card is expanded", () => {
    const metadata = makeMetadata({ uid: "1", description: "A fantastic catalog addon" });
    render(
      <CatalogCard
        addon={makeAddon()}
        {...defaultProps}
        metadata={metadata}
        metadataLoading={false}
      />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.getByText("A fantastic catalog addon")).toBeInTheDocument();
  });

  it("shows 'Loading details...' when UID is loading and metadata is not yet available", () => {
    render(
      <CatalogCard
        addon={makeAddon()}
        {...defaultProps}
        metadata={undefined}
        metadataLoading={true}
      />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.getByText("Loading details...")).toBeInTheDocument();
  });

  it("does not show 'Loading details...' when metadata is already available even if loading flag is set", () => {
    const metadata = makeMetadata({ uid: "1", description: "Already here" });
    render(
      <CatalogCard
        addon={makeAddon()}
        {...defaultProps}
        metadata={metadata}
        metadataLoading={true}
      />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.queryByText("Loading details...")).not.toBeInTheDocument();
    expect(screen.getByText("Already here")).toBeInTheDocument();
  });

  it("renders compatibility badges from JSON-encoded metadata.compatibility", () => {
    const metadata = makeMetadata({
      compatibility: JSON.stringify([
        { version: "101047", name: "U43 Secrets" },
        { version: "101046", name: "" },
      ]),
    });
    render(<CatalogCard addon={makeAddon()} {...defaultProps} metadata={metadata} />);
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.getByText("U43 Secrets")).toBeInTheDocument();
    expect(screen.getByText("101046")).toBeInTheDocument();
  });

  it("does not throw when compatibility JSON is malformed", () => {
    const metadata = makeMetadata({ compatibility: "{not valid json" });
    render(<CatalogCard addon={makeAddon()} {...defaultProps} metadata={metadata} />);
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(screen.getByText("Test Catalog Addon")).toBeInTheDocument();
  });

  it("renders 'Support Author' button wired to donation_link", () => {
    const metadata = makeMetadata({ donation_link: "https://donate.example.com/y" });
    render(<CatalogCard addon={makeAddon()} {...defaultProps} metadata={metadata} />);
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    fireEvent.click(screen.getByRole("button", { name: /Support Author/ }));
    expect(openUrl).toHaveBeenCalledWith("https://donate.example.com/y");
  });

  it("renders screenshot thumbnails and opens full-size on click", () => {
    const metadata = makeMetadata({
      img_thumbs: JSON.stringify(["https://cdn/t1.png"]),
      imgs: JSON.stringify(["https://cdn/full1.png"]),
    });
    const { container } = render(
      <CatalogCard addon={makeAddon()} {...defaultProps} metadata={metadata} />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    const img = container.querySelector("img[alt^='Screenshot']");
    expect(img).not.toBeNull();
    fireEvent.click(img!);
    expect(openUrl).toHaveBeenCalledWith("https://cdn/full1.png");
  });

  it("falls back to thumb URL when imgs is null", () => {
    const metadata = makeMetadata({
      img_thumbs: JSON.stringify(["https://cdn/only-thumb.png"]),
      imgs: null,
    });
    const { container } = render(
      <CatalogCard addon={makeAddon()} {...defaultProps} metadata={metadata} />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    const img = container.querySelector("img[alt^='Screenshot']");
    fireEvent.click(img!);
    expect(openUrl).toHaveBeenCalledWith("https://cdn/only-thumb.png");
  });

  it("renders nothing for screenshots when img_thumbs is malformed JSON", () => {
    const metadata = makeMetadata({ img_thumbs: "not-json" });
    const { container } = render(
      <CatalogCard addon={makeAddon()} {...defaultProps} metadata={metadata} />
    );
    fireEvent.click(screen.getByText("Test Catalog Addon"));
    expect(container.querySelector("img[alt^='Screenshot']")).toBeNull();
  });
});
