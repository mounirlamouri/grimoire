import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BrowsePage } from "./BrowsePage";
import type { CatalogAddon } from "../types/addon";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

import { invoke } from "@tauri-apps/api/core";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

const PAGE_SIZE = 50;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeAddon(index: number, isLibrary = false): CatalogAddon {
  return {
    uid: `uid-${index}`,
    name: `Addon ${index}`,
    version: "1.0",
    date: Date.now(),
    downloads: 1000 - index,
    favorites: 0,
    downloads_monthly: 0,
    directories: `Addon${index}`,
    category_id: isLibrary ? "53" : "12",
    author: "Author",
    download_url: null,
    file_info_url: null,
    is_library: isLibrary,
  };
}

/** A full page whose rows include a library, as the backend returns when libraries are shown. */
function pageWithLibrary(): CatalogAddon[] {
  return Array.from({ length: PAGE_SIZE }, (_, i) => makeAddon(i, i === 3));
}

type SearchHandler = (args: { offset: number; includeLibraries: boolean }) => CatalogAddon[];

function mockBackend(search: SearchHandler) {
  mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "search_addons":
        return Promise.resolve(
          search({
            offset: args?.offset as number,
            includeLibraries: args?.includeLibraries as boolean,
          })
        );
      case "get_catalog_status":
        return Promise.resolve({ addon_count: 500, last_sync: null });
      case "get_installed_addons":
        return Promise.resolve([]);
      case "get_staleness_warning_days":
        return Promise.resolve(180);
      case "get_staleness_error_days":
        return Promise.resolve(365);
      case "get_hide_staleness_warnings":
        return Promise.resolve(false);
      case "fetch_addon_metadata":
        return Promise.resolve({});
      default:
        return Promise.resolve(undefined);
    }
  });
}

function renderBrowse() {
  render(
    <BrowsePage onError={vi.fn()} onSuccess={vi.fn()} onSync={vi.fn()} syncing={false} />
  );
}

function nextButton() {
  return screen.getByRole("button", { name: "Next" });
}

function previousButton() {
  return screen.getByRole("button", { name: "Previous" });
}

function searchCalls() {
  return mockInvoke.mock.calls.filter(([cmd]) => cmd === "search_addons");
}

function lastSearchArgs() {
  const calls = searchCalls();
  return calls[calls.length - 1][1] as Record<string, unknown>;
}

describe("BrowsePage pagination", () => {
  it("asks the backend to exclude libraries by default", async () => {
    mockBackend(() => [makeAddon(0)]);
    renderBrowse();

    await screen.findByText("Addon 0");
    expect(lastSearchArgs()).toMatchObject({
      query: "",
      limit: PAGE_SIZE,
      offset: 0,
      includeLibraries: false,
    });
  });

  it("keeps 'Next' enabled on a full page that contains a library", async () => {
    // Regression: libraries used to be dropped in the browser after paging,
    // so a single library on the page made it look like the last one.
    mockBackend(() => pageWithLibrary());
    renderBrowse();

    await screen.findByText("Addon 0");
    expect(screen.getByText("Addon 3")).toBeTruthy();
    expect(nextButton().hasAttribute("disabled")).toBe(false);
  });

  it("disables 'Next' on a short last page and keeps 'Previous' usable", async () => {
    mockBackend(({ offset }) =>
      offset === 0
        ? Array.from({ length: PAGE_SIZE }, (_, i) => makeAddon(i))
        : [makeAddon(100), makeAddon(101)]
    );
    renderBrowse();

    await screen.findByText("Addon 0");
    expect(nextButton().hasAttribute("disabled")).toBe(false);

    fireEvent.click(nextButton());

    await screen.findByText("Addon 100");
    expect(screen.getByText("Page 2")).toBeTruthy();
    expect(nextButton().hasAttribute("disabled")).toBe(true);
    expect(previousButton().hasAttribute("disabled")).toBe(false);

    fireEvent.click(previousButton());
    await screen.findByText("Addon 0");
    expect(screen.getByText("Page 1")).toBeTruthy();
  });

  it("reloads from the backend and returns to page 1 when 'Show libraries' is toggled", async () => {
    mockBackend(({ offset, includeLibraries }) =>
      includeLibraries
        ? [makeAddon(500, true)]
        : Array.from({ length: PAGE_SIZE }, (_, i) => makeAddon(offset + i))
    );
    renderBrowse();

    await screen.findByText("Addon 0");
    fireEvent.click(nextButton());
    await screen.findByText("Page 2");

    fireEvent.click(screen.getByLabelText("Show libraries"));

    await screen.findByText("Addon 500");
    expect(screen.getByText("Page 1")).toBeTruthy();
    await waitFor(() =>
      expect(lastSearchArgs()).toMatchObject({ offset: 0, includeLibraries: true })
    );
  });

  it("resets to page 1 when the search query changes", async () => {
    mockBackend(({ offset }) =>
      Array.from({ length: PAGE_SIZE }, (_, i) => makeAddon(offset + i))
    );
    renderBrowse();

    await screen.findByText("Addon 0");
    fireEvent.click(nextButton());
    await screen.findByText("Page 2");

    fireEvent.change(screen.getByPlaceholderText("Search addons by name or author..."), {
      target: { value: "map" },
    });

    await screen.findByText("Page 1");
    await waitFor(() =>
      expect(lastSearchArgs()).toMatchObject({ query: "map", offset: 0 })
    );
  });
});
