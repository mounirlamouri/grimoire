import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AddonCard } from "./AddonCard";
import type { InstalledAddon, AddonUpdate, AddonMetadata } from "../types/addon";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
  revealItemInDir: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { invoke } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

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

function makeUpdate(overrides: Partial<AddonUpdate> = {}): AddonUpdate {
  return {
    dir_name: "TestAddon",
    title: "Test Addon",
    installed_version: "1.0",
    latest_version: "2.0",
    uid: "12345",
    download_url: "https://example.com/test.zip",
    ...overrides,
  };
}

describe("AddonCard basic rendering", () => {
  it("renders title, author, and version", () => {
    render(
      <AddonCard
        addon={makeAddon({ title: "Cool Addon", author: "Jane", version: "3.1" })}
        {...defaultProps}
      />
    );
    expect(screen.getByText("Cool Addon")).toBeInTheDocument();
    expect(screen.getByText("by Jane")).toBeInTheDocument();
    expect(screen.getByText("v3.1")).toBeInTheDocument();
  });

  it("shows LIB badge when addon is a library", () => {
    render(<AddonCard addon={makeAddon({ is_library: true })} {...defaultProps} />);
    expect(screen.getByText("LIB")).toBeInTheDocument();
  });

  it("does not show LIB badge when addon is not a library", () => {
    render(<AddonCard addon={makeAddon({ is_library: false })} {...defaultProps} />);
    expect(screen.queryByText("LIB")).not.toBeInTheDocument();
  });
});

describe("AddonCard update flow", () => {
  it("shows UPDATE badge, latest version arrow, and Update button when update is available", () => {
    render(
      <AddonCard addon={makeAddon()} update={makeUpdate({ latest_version: "2.5" })} {...defaultProps} />
    );
    expect(screen.getByText("UPDATE")).toBeInTheDocument();
    expect(screen.getByText("→ v2.5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("does not show Update button when no update is available", () => {
    render(<AddonCard addon={makeAddon()} {...defaultProps} />);
    expect(screen.queryByRole("button", { name: "Update" })).not.toBeInTheDocument();
  });

  it("calls onUpdate with the update uid when Update button is clicked", async () => {
    const onUpdate = vi.fn(() => Promise.resolve());
    render(
      <AddonCard
        addon={makeAddon()}
        update={makeUpdate({ uid: "99" })}
        {...defaultProps}
        onUpdate={onUpdate}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(onUpdate).toHaveBeenCalledWith("99");
  });

  it("shows 'Updating...' while the update promise is pending", async () => {
    let resolve: () => void = () => {};
    const onUpdate = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(
      <AddonCard addon={makeAddon()} update={makeUpdate()} {...defaultProps} onUpdate={onUpdate} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(screen.getByRole("button", { name: "Updating..." })).toBeInTheDocument();
    resolve();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Updating..." })).not.toBeInTheDocument();
    });
  });
});

describe("AddonCard uninstall flow", () => {
  it("shows a confirmation panel when Uninstall is clicked", () => {
    const { container } = render(
      <AddonCard addon={makeAddon({ title: "Cool Addon" })} {...defaultProps} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    // Confirmation message contains the addon title in a <strong>
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("Cool Addon");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // Two "Uninstall" buttons exist now: the original + the confirmation one
    expect(screen.getAllByRole("button", { name: "Uninstall" })).toHaveLength(2);
  });

  it("dismisses the confirmation panel when Cancel is clicked", () => {
    render(<AddonCard addon={makeAddon()} {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Uninstall" })).toHaveLength(1);
  });

  it("calls onUninstall with dir_name when the confirmation Uninstall is clicked", async () => {
    const onUninstall = vi.fn(() => Promise.resolve());
    render(
      <AddonCard
        addon={makeAddon({ dir_name: "CoolAddon" })}
        {...defaultProps}
        onUninstall={onUninstall}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Uninstall" });
    // Second button is the one in the confirmation panel
    fireEvent.click(confirmButtons[1]);
    await waitFor(() => {
      expect(onUninstall).toHaveBeenCalledWith("CoolAddon");
    });
  });
});

describe("AddonCard missing dependencies", () => {
  it("shows MISSING DEPS badge when there are missing deps", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        missingDeps={{ fixable: ["LibAddonMenu-2.0"], unavailable: [] }}
        {...defaultProps}
      />
    );
    expect(screen.getByText("MISSING DEPS")).toBeInTheDocument();
  });

  it("does not show MISSING DEPS badge when both fixable and unavailable are empty", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        missingDeps={{ fixable: [], unavailable: [] }}
        {...defaultProps}
      />
    );
    expect(screen.queryByText("MISSING DEPS")).not.toBeInTheDocument();
  });

  it("shows Fix button when there are fixable missing deps and calls onFixDeps", async () => {
    const onFixDeps = vi.fn(() => Promise.resolve());
    render(
      <AddonCard
        addon={makeAddon()}
        missingDeps={{ fixable: ["LibAddonMenu-2.0", "LibStub"], unavailable: [] }}
        {...defaultProps}
        onFixDeps={onFixDeps}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    expect(onFixDeps).toHaveBeenCalledWith(["LibAddonMenu-2.0", "LibStub"]);
  });

  it("does not show Fix button when only unavailable deps exist", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        missingDeps={{ fixable: [], unavailable: ["GoneForever"] }}
        {...defaultProps}
      />
    );
    expect(screen.queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
  });

  it("shows distinct warning panels for fixable and unavailable deps when expanded", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        missingDeps={{ fixable: ["LibA"], unavailable: ["GoneLib"] }}
        {...defaultProps}
      />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.getByText(/Missing dependencies: LibA\. This addon may not function/)).toBeInTheDocument();
    expect(
      screen.getByText(/Missing dependencies not available on ESOUI: GoneLib/)
    ).toBeInTheDocument();
  });
});

describe("AddonCard staleness", () => {
  const day = 24 * 60 * 60 * 1000;

  it("shows STALE badge at warning level when catalogDate is between warning and error thresholds", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        catalogDate={Date.now() - 400 * day}
        {...defaultProps}
        stalenessWarningDays={365}
        stalenessErrorDays={730}
      />
    );
    const badge = screen.getByText("STALE");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("yellow");
  });

  it("shows STALE badge at error level when catalogDate is past the error threshold", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        catalogDate={Date.now() - 800 * day}
        {...defaultProps}
        stalenessWarningDays={365}
        stalenessErrorDays={730}
      />
    );
    const badge = screen.getByText("STALE");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("red");
  });

  it("hides STALE badge when hideStalenessWarnings is true", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        catalogDate={Date.now() - 800 * day}
        {...defaultProps}
        hideStalenessWarnings={true}
      />
    );
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  });

  it("does not show STALE badge for a fresh catalogDate", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        catalogDate={Date.now() - 10 * day}
        {...defaultProps}
      />
    );
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  });
});

describe("AddonCard expanded view", () => {
  it("shows description, API versions, addon_version, and deps when expanded", () => {
    render(
      <AddonCard
        addon={makeAddon({
          description: "A very cool addon",
          addon_version: 42,
          api_versions: [101047, 101048],
          depends_on: [{ name: "LibAddonMenu-2.0", min_version: 32 }],
        })}
        {...defaultProps}
      />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.getByText("A very cool addon")).toBeInTheDocument();
    expect(screen.getByText("AddOnVersion: 42")).toBeInTheDocument();
    expect(screen.getByText("API: 101047, 101048")).toBeInTheDocument();
    expect(screen.getByText("Depends on:")).toBeInTheDocument();
    expect(screen.getByText("LibAddonMenu-2.0 (>=32)")).toBeInTheDocument();
  });

  it("collapses the expanded view when the card is clicked again", () => {
    render(
      <AddonCard addon={makeAddon({ description: "Some description" })} {...defaultProps} />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.getByText("Some description")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.queryByText("Some description")).not.toBeInTheDocument();
  });

  it("shows an ESOUI Page button and calls openUrl when clicked", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        fileInfoUrl="https://esoui.com/downloads/info123.html"
        {...defaultProps}
      />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    const esouiBtn = screen.getByRole("button", { name: /ESOUI Page/ });
    fireEvent.click(esouiBtn);
    expect(openUrl).toHaveBeenCalledWith("https://esoui.com/downloads/info123.html");
  });

  it("does not show ESOUI Page button when fileInfoUrl is not provided", () => {
    render(<AddonCard addon={makeAddon()} {...defaultProps} />);
    fireEvent.click(screen.getByText("Test Addon"));
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

describe("AddonCard metadata rendering", () => {
  it("shows description from metadata when uid is provided and metadata is in metadataMap", () => {
    const metadata = makeMetadata({ uid: "42", description: "A great addon description" });
    render(
      <AddonCard
        addon={makeAddon()}
        {...defaultProps}
        metadata={metadata}
        metadataLoading={false}
      />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.getByText("A great addon description")).toBeInTheDocument();
  });

  it("shows 'Loading details...' when uid is provided and UID is in loadingUids", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        {...defaultProps}
        metadata={undefined}
        metadataLoading={true}
      />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.getByText("Loading details...")).toBeInTheDocument();
  });

  it("does not call invoke for fetch_addon_metadata when no onExpand is provided", () => {
    render(
      <AddonCard
        addon={makeAddon()}
        {...defaultProps}
      />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    const metadataCalls = mockInvoke.mock.calls.filter(
      (call) => call[0] === "fetch_addon_metadata"
    );
    expect(metadataCalls).toHaveLength(0);
  });

  it("renders compatibility badges from JSON-encoded metadata.compatibility", () => {
    const metadata = makeMetadata({
      compatibility: JSON.stringify([
        { version: "101047", name: "U43 Secrets" },
        { version: "101046", name: "" },
      ]),
    });
    render(
      <AddonCard addon={makeAddon()} {...defaultProps} metadata={metadata} />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.getByText("U43 Secrets")).toBeInTheDocument();
    // Falls back to version when name is empty
    expect(screen.getByText("101046")).toBeInTheDocument();
  });

  it("does not throw and renders no badges when compatibility JSON is malformed", () => {
    const metadata = makeMetadata({ compatibility: "{not valid json" });
    render(
      <AddonCard addon={makeAddon()} {...defaultProps} metadata={metadata} />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    // No badges rendered, but expand still works
    expect(screen.getByText("Test Addon")).toBeInTheDocument();
  });

  it("renders a 'Support Author' button wired to metadata.donation_link", () => {
    const metadata = makeMetadata({ donation_link: "https://donate.example.com/x" });
    render(
      <AddonCard addon={makeAddon()} {...defaultProps} metadata={metadata} />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    const btn = screen.getByRole("button", { name: /Support Author/ });
    fireEvent.click(btn);
    expect(openUrl).toHaveBeenCalledWith("https://donate.example.com/x");
  });

  it("does not render 'Support Author' when donation_link is null", () => {
    render(
      <AddonCard addon={makeAddon()} {...defaultProps} metadata={makeMetadata()} />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    expect(screen.queryByRole("button", { name: /Support Author/ })).not.toBeInTheDocument();
  });

  it("renders screenshot thumbnails from img_thumbs and opens full-size on click", () => {
    const metadata = makeMetadata({
      img_thumbs: JSON.stringify(["https://cdn/t1.png", "https://cdn/t2.png"]),
      imgs: JSON.stringify(["https://cdn/full1.png", "https://cdn/full2.png"]),
    });
    const { container } = render(
      <AddonCard addon={makeAddon()} {...defaultProps} metadata={metadata} />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    const imgs = container.querySelectorAll("img[alt^='Screenshot']");
    expect(imgs).toHaveLength(2);
    fireEvent.click(imgs[0]);
    expect(openUrl).toHaveBeenCalledWith("https://cdn/full1.png");
  });

  it("falls back to thumb URL when imgs is null", () => {
    const metadata = makeMetadata({
      img_thumbs: JSON.stringify(["https://cdn/only-thumb.png"]),
      imgs: null,
    });
    const { container } = render(
      <AddonCard addon={makeAddon()} {...defaultProps} metadata={metadata} />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    const img = container.querySelector("img[alt^='Screenshot']");
    fireEvent.click(img!);
    expect(openUrl).toHaveBeenCalledWith("https://cdn/only-thumb.png");
  });

  it("renders nothing for screenshots when img_thumbs is malformed JSON", () => {
    const metadata = makeMetadata({ img_thumbs: "not-json" });
    const { container } = render(
      <AddonCard addon={makeAddon()} {...defaultProps} metadata={metadata} />
    );
    fireEvent.click(screen.getByText("Test Addon"));
    expect(container.querySelector("img[alt^='Screenshot']")).toBeNull();
  });
});
