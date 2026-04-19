import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAddonMetadata } from "./useAddonMetadata";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(() => Promise.resolve()),
  revealItemInDir: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useAddonMetadata fetchMetadata debouncing", () => {
  it("adds UID to loadingUids and calls invoke after debounce", async () => {
    const metadata = { uid: "1", description: "Desc", compatibility: null, donation_link: null, img_thumbs: null, imgs: null, siblings: null, ui_date: null, fetched_at: 0 };
    mockInvoke.mockResolvedValueOnce({ "1": metadata });

    const { result } = renderHook(() => useAddonMetadata());

    act(() => {
      result.current.fetchMetadata("1");
    });

    // Before debounce fires, invoke should not have been called yet
    expect(mockInvoke).not.toHaveBeenCalled();

    // Advance timers past the 100ms debounce
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(mockInvoke).toHaveBeenCalledWith("fetch_addon_metadata", { uids: ["1"] });
  });

  it("batches multiple UIDs added within debounce window into a single invoke call", async () => {
    const meta1 = { uid: "1", description: "A", compatibility: null, donation_link: null, img_thumbs: null, imgs: null, siblings: null, ui_date: null, fetched_at: 0 };
    const meta2 = { uid: "2", description: "B", compatibility: null, donation_link: null, img_thumbs: null, imgs: null, siblings: null, ui_date: null, fetched_at: 0 };
    const meta3 = { uid: "3", description: "C", compatibility: null, donation_link: null, img_thumbs: null, imgs: null, siblings: null, ui_date: null, fetched_at: 0 };
    mockInvoke.mockResolvedValueOnce({ "1": meta1, "2": meta2, "3": meta3 });

    const { result } = renderHook(() => useAddonMetadata());

    act(() => {
      result.current.fetchMetadata("1");
      result.current.fetchMetadata("2");
      result.current.fetchMetadata("3");
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Should be a single call with all three UIDs
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const calledUids: string[] = mockInvoke.mock.calls[0][1].uids;
    expect(calledUids).toContain("1");
    expect(calledUids).toContain("2");
    expect(calledUids).toContain("3");
  });

  it("does not duplicate a UID when fetchMetadata is called twice for same UID within debounce", async () => {
    mockInvoke.mockResolvedValueOnce({});

    const { result } = renderHook(() => useAddonMetadata());

    act(() => {
      result.current.fetchMetadata("42");
      result.current.fetchMetadata("42");
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const calledUids: string[] = mockInvoke.mock.calls[0][1].uids;
    expect(calledUids.filter((u) => u === "42")).toHaveLength(1);
  });
});

describe("useAddonMetadata fetch result handling", () => {
  it("removes UID from loadingUids and adds it to metadataMap on success", async () => {
    const metadata = { uid: "10", description: "Hello", compatibility: null, donation_link: null, img_thumbs: null, imgs: null, siblings: null, ui_date: null, fetched_at: 0 };
    mockInvoke.mockResolvedValueOnce({ "10": metadata });

    const { result } = renderHook(() => useAddonMetadata());

    act(() => {
      result.current.fetchMetadata("10");
    });

    // Run all pending timers and flush async callbacks (avoids waitFor deadlock with fake timers)
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.loadingUids.has("10")).toBe(false);
    expect(result.current.metadataMap.has("10")).toBe(true);
    expect(result.current.metadataMap.get("10")?.description).toBe("Hello");
  });

  it("removes UID from loadingUids and calls console.warn on invoke rejection", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useAddonMetadata());

    act(() => {
      result.current.fetchMetadata("99");
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.loadingUids.has("99")).toBe(false);
    expect(result.current.metadataMap.has("99")).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("useAddonMetadata caching", () => {
  it("does not call invoke again for an already-cached UID", async () => {
    const metadata = { uid: "5", description: "Cached", compatibility: null, donation_link: null, img_thumbs: null, imgs: null, siblings: null, ui_date: null, fetched_at: 0 };
    mockInvoke.mockResolvedValueOnce({ "5": metadata });

    const { result } = renderHook(() => useAddonMetadata());

    // First fetch
    act(() => {
      result.current.fetchMetadata("5");
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.metadataMap.has("5")).toBe(true);

    // Second fetch for same UID — should not trigger another invoke
    act(() => {
      result.current.fetchMetadata("5");
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Still only one call total
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe("useAddonMetadata timer cleanup", () => {
  it("does not call invoke when component unmounts before debounce fires", () => {
    mockInvoke.mockResolvedValue({});

    const { result, unmount } = renderHook(() => useAddonMetadata());

    act(() => {
      result.current.fetchMetadata("77");
    });

    // Unmount before the 100ms debounce elapses
    unmount();

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("useAddonMetadata cache invalidation", () => {
  it("clears metadataMap when catalog-sync-progress event with stage 'done' is received", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const mockListen = listen as ReturnType<typeof vi.fn>;

    let capturedCallback: ((event: { payload: { stage: string } }) => void) | null = null;
    mockListen.mockImplementation((_event: string, cb: (event: { payload: { stage: string } }) => void) => {
      capturedCallback = cb;
      return Promise.resolve(() => {});
    });

    const metadata = { uid: "3", description: "Test", compatibility: null, donation_link: null, img_thumbs: null, imgs: null, siblings: null, ui_date: null, fetched_at: 0 };
    mockInvoke.mockResolvedValueOnce({ "3": metadata });

    const { result } = renderHook(() => useAddonMetadata());

    // Populate the cache
    act(() => {
      result.current.fetchMetadata("3");
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.metadataMap.has("3")).toBe(true);

    // Simulate receiving a catalog-sync-progress "done" event
    act(() => {
      if (capturedCallback) {
        capturedCallback({ payload: { stage: "done" } });
      }
    });

    expect(result.current.metadataMap.size).toBe(0);
  });
});

describe("useAddonMetadata in-flight fetch after cache clear", () => {
  it("discards fetch results when catalog sync fires during an in-flight request", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const mockListen = listen as ReturnType<typeof vi.fn>;

    let capturedCallback: ((event: { payload: { stage: string } }) => void) | null = null;
    mockListen.mockImplementation((_event: string, cb: (event: { payload: { stage: string } }) => void) => {
      capturedCallback = cb;
      return Promise.resolve(() => {});
    });

    let resolveInvoke: (value: Record<string, unknown>) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => { resolveInvoke = resolve; })
    );

    const { result } = renderHook(() => useAddonMetadata());

    act(() => {
      result.current.fetchMetadata("abc");
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      capturedCallback!({ payload: { stage: "done" } });
    });

    const staleMeta = { uid: "abc", description: "stale", compatibility: null, donation_link: null, img_thumbs: null, imgs: null, siblings: null, ui_date: null, fetched_at: 0 };
    await act(async () => {
      resolveInvoke({ abc: staleMeta });
      await vi.runAllTimersAsync();
    });

    expect(result.current.metadataMap.has("abc")).toBe(false);
  });
});
