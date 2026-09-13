import { describe, it, expect, vi } from "vitest";
import { runBatchUpdate, summarizeBatchUpdate, type BatchUpdateOutcome } from "./batchUpdate";
import type { AddonUpdate, InstallResult } from "../types/addon";

function makeUpdate(uid: string, title: string): AddonUpdate {
  return {
    dir_name: title,
    title,
    installed_version: "1.0",
    latest_version: "2.0",
    uid,
    download_url: null,
  };
}

function okResult(overrides: Partial<InstallResult> = {}): InstallResult {
  return {
    installed_dirs: [],
    auto_installed_deps: [],
    missing_deps: [],
    failed_deps: [],
    ...overrides,
  };
}

describe("runBatchUpdate", () => {
  it("updates sequentially and reports progress before each addon", async () => {
    const updates = [makeUpdate("1", "Alpha"), makeUpdate("2", "Beta"), makeUpdate("3", "Gamma")];
    const events: string[] = [];
    const updateOne = vi.fn(async (uid: string) => {
      events.push(`update:${uid}`);
      return okResult();
    });
    const onProgress = vi.fn((p) => events.push(`progress:${p.completed}/${p.total}:${p.title}`));

    const outcome = await runBatchUpdate(updates, updateOne, onProgress);

    expect(events).toEqual([
      "progress:0/3:Alpha",
      "update:1",
      "progress:1/3:Beta",
      "update:2",
      "progress:2/3:Gamma",
      "update:3",
    ]);
    expect(outcome.updatedUids).toEqual(["1", "2", "3"]);
    expect(outcome.failures).toEqual([]);
    expect(outcome.total).toBe(3);
  });

  it("keeps going after a failure and records it", async () => {
    const updates = [makeUpdate("1", "Alpha"), makeUpdate("2", "Beta"), makeUpdate("3", "Gamma")];
    const updateOne = vi.fn(async (uid: string) => {
      if (uid === "2") throw "download failed";
      return okResult();
    });

    const outcome = await runBatchUpdate(updates, updateOne, () => {});

    expect(updateOne).toHaveBeenCalledTimes(3);
    expect(outcome.updatedUids).toEqual(["1", "3"]);
    expect(outcome.failures).toEqual(["Beta: download failed"]);
  });

  it("collects dependency warnings and deduplicates auto-installed deps", async () => {
    const updates = [makeUpdate("1", "Alpha"), makeUpdate("2", "Beta")];
    const results: Record<string, InstallResult> = {
      "1": okResult({ auto_installed_deps: [{ name: "LibA", dir_name: "LibA" } as never] }),
      "2": okResult({
        auto_installed_deps: [{ name: "LibA", dir_name: "LibA" } as never],
        missing_deps: ["LibMissing"],
        failed_deps: [{ dir_name: "LibBroken", error: "bad zip" } as never],
      }),
    };

    const outcome = await runBatchUpdate(updates, async (uid) => results[uid], () => {});

    expect(outcome.updatedUids).toEqual(["1", "2"]);
    expect(outcome.autoInstalledDeps).toEqual(["LibA"]);
    expect(outcome.depWarnings).toEqual([
      "Beta: not found on ESOUI: LibMissing; failed to install: LibBroken (bad zip)",
    ]);
  });
});

describe("summarizeBatchUpdate", () => {
  const base: BatchUpdateOutcome = {
    total: 3,
    updatedUids: ["1", "2", "3"],
    failures: [],
    depWarnings: [],
    autoInstalledDeps: [],
  };

  it("returns a single success message when everything updated", () => {
    expect(summarizeBatchUpdate(base)).toEqual({
      kind: "success",
      message: "3 addons updated successfully.",
      details: null,
    });
  });

  it("uses singular wording for one addon", () => {
    const summary = summarizeBatchUpdate({ ...base, total: 1, updatedUids: ["1"] });
    expect(summary.message).toBe("1 addon updated successfully.");
  });

  it("lists auto-installed dependencies in success details", () => {
    const summary = summarizeBatchUpdate({ ...base, autoInstalledDeps: ["LibA", "LibB"] });
    expect(summary).toEqual({
      kind: "success",
      message: "3 addons updated successfully.",
      details: "Automatically installed dependencies: LibA, LibB",
    });
  });

  it("returns an error summary with failures in the details", () => {
    const summary = summarizeBatchUpdate({
      ...base,
      updatedUids: ["1"],
      failures: ["Beta: boom", "Gamma: bang"],
    });
    expect(summary.kind).toBe("error");
    const [head, ...rest] = summary.message.split("\n\n");
    expect(head).toBe("2 of 3 addons failed to update.");
    expect(rest.join("\n\n")).toBe("Failed to update:\nBeta: boom\nGamma: bang");
  });

  it("returns an error summary when only dependency warnings occurred", () => {
    const summary = summarizeBatchUpdate({
      ...base,
      depWarnings: ["Beta: not found on ESOUI: LibX"],
      autoInstalledDeps: ["LibA"],
    });
    expect(summary.kind).toBe("error");
    expect(summary.message).toBe(
      "3 addons updated, but some may not function properly because dependencies could not be installed." +
        "\n\nUpdated with dependency problems:\nBeta: not found on ESOUI: LibX" +
        "\n\nAutomatically installed dependencies: LibA"
    );
  });
});
