import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ImportEntry, ImportProgress, ImportResult } from "../types/addon";

type Step = "input" | "review" | "installing" | "done";

export function ImportModal({
  onClose,
  onError,
  onDone,
}: {
  onClose: () => void;
  onError: (msg: string) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>("input");
  const [textContent, setTextContent] = useState("");
  const [pasteUrl, setPasteUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [parsing, setParsing] = useState(false);

  // Review step
  const [entries, setEntries] = useState<ImportEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Install step
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    const unlisten = listen<ImportProgress>("import-progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleFetchPaste = async () => {
    if (!pasteUrl.trim()) return;
    setFetching(true);
    try {
      const content = await invoke<string>("fetch_paste", {
        urlOrId: pasteUrl.trim(),
      });
      setTextContent(content);
    } catch (err) {
      onError(`Failed to fetch paste: ${err}`);
    } finally {
      setFetching(false);
    }
  };

  const handleParse = async () => {
    if (!textContent.trim()) return;
    setParsing(true);
    try {
      const parsed = await invoke<ImportEntry[]>("parse_addon_list", {
        content: textContent,
      });
      if (parsed.length === 0) {
        onError("No addon entries found in the provided text.");
        setParsing(false);
        return;
      }
      setEntries(parsed);
      // Select all that are in catalog and not already installed
      setSelected(
        new Set(
          parsed
            .filter((e) => e.in_catalog && !e.already_installed)
            .map((e) => e.dir_name)
        )
      );
      setStep("review");
    } catch (err) {
      onError(`Parse failed: ${err}`);
    } finally {
      setParsing(false);
    }
  };

  const toggleEntry = (dirName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(dirName)) {
        next.delete(dirName);
      } else {
        next.add(dirName);
      }
      return next;
    });
  };

  const selectAllAvailable = () => {
    setSelected(
      new Set(
        entries
          .filter((e) => e.in_catalog && !e.already_installed)
          .map((e) => e.dir_name)
      )
    );
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  const handleInstall = async () => {
    const dirNames = entries
      .filter((e) => selected.has(e.dir_name))
      .map((e) => e.dir_name);
    if (dirNames.length === 0) return;

    setStep("installing");
    setProgress(null);
    try {
      const res = await invoke<ImportResult>("import_install_addons", {
        dirNames,
      });
      setResult(res);
      setStep("done");
    } catch (err) {
      onError(`Import failed: ${err}`);
      setStep("review");
    }
  };

  const handleDone = () => {
    onDone();
    onClose();
  };

  const installableCount = entries.filter(
    (e) => e.in_catalog && !e.already_installed
  ).length;
  const selectedCount = selected.size;

  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-[var(--teal-dim)]/40 bg-[var(--bg-secondary)] p-5 shadow-xl">
        {step === "input" && (
          <>
            <h3 className="mb-3 text-sm font-semibold text-[var(--accent)]">
              Import Addon List
            </h3>

            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                From paste.rs URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  placeholder="https://paste.rs/AbCd or just AbCd"
                  className="flex-1 rounded border border-[var(--teal-dim)]/30 bg-[var(--bg-primary)] px-3 py-2 text-sm text-white placeholder:text-[var(--text-secondary)]"
                />
                <button
                  onClick={handleFetchPaste}
                  disabled={!pasteUrl.trim() || fetching}
                  className="rounded border border-[var(--teal)]/30 px-3 py-2 text-sm text-[var(--teal)] transition hover:bg-[var(--teal)]/10 disabled:opacity-50"
                >
                  {fetching ? "Fetching..." : "Fetch"}
                </button>
              </div>
            </div>

            <div className="mb-1 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-[var(--text-secondary)]">or paste directly</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <div className="mb-3">
              <textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder={"# Paste your addon list here\n# One addon per line\nDolgubons-Lazy-Writ-Crafter\nLoreBooks\n..."}
                rows={8}
                className="w-full rounded border border-[var(--teal-dim)]/30 bg-[var(--bg-primary)] px-3 py-2 text-sm text-white placeholder:text-[var(--text-secondary)] font-mono resize-none"
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={onClose}
                className="rounded border border-[var(--teal-dim)]/30 px-4 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleParse}
                disabled={!textContent.trim() || parsing}
                className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {parsing ? "Parsing..." : "Parse"}
              </button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <h3 className="mb-3 text-sm font-semibold text-[var(--accent)]">
              Review Addons to Import
            </h3>

            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={selectAllAvailable}
                className="text-xs text-[var(--teal)] hover:underline"
              >
                Select all available
              </button>
              <span className="text-xs text-[var(--text-secondary)]">/</span>
              <button
                onClick={deselectAll}
                className="text-xs text-[var(--teal)] hover:underline"
              >
                Deselect all
              </button>
              <span className="ml-auto text-xs text-[var(--text-secondary)]">
                {selectedCount} of {installableCount} available selected
              </span>
            </div>

            <div className="max-h-80 overflow-auto rounded border border-white/10 bg-[var(--bg-primary)] p-2 space-y-0.5">
              {entries.map((entry) => {
                const disabled = entry.already_installed || !entry.in_catalog;
                return (
                  <label
                    key={entry.dir_name}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
                      disabled
                        ? "opacity-50 cursor-default"
                        : "hover:bg-white/5 cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(entry.dir_name)}
                      onChange={() => !disabled && toggleEntry(entry.dir_name)}
                      disabled={disabled}
                      className="accent-[var(--teal)]"
                    />
                    <span className="text-[var(--text-primary)]">
                      {entry.catalog_name || entry.dir_name}
                    </span>
                    {entry.catalog_name && (
                      <span className="text-xs text-[var(--text-secondary)]">
                        {entry.dir_name}
                      </span>
                    )}
                    {entry.already_installed && (
                      <span className="ml-auto rounded bg-[var(--teal)]/20 px-1.5 py-0.5 text-xs text-[var(--teal)]">
                        Installed
                      </span>
                    )}
                    {!entry.in_catalog && !entry.already_installed && (
                      <span className="ml-auto rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400">
                        Not in catalog
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => setStep("input")}
                className="rounded border border-[var(--teal-dim)]/30 px-4 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white"
              >
                Back
              </button>
              <button
                onClick={handleInstall}
                disabled={selectedCount === 0}
                className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
              >
                Install {selectedCount} Addon{selectedCount !== 1 ? "s" : ""}
              </button>
            </div>
          </>
        )}

        {step === "installing" && (
          <>
            <h3 className="mb-3 text-sm font-semibold text-[var(--accent)]">
              Installing Addons
            </h3>
            <p className="mb-3 text-sm text-[var(--text-primary)]">
              {progress
                ? `Installing ${progress.dir_name}...`
                : "Preparing..."}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-primary)]">
              <div
                className="h-full rounded-full bg-[var(--teal)] transition-all duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              {progress
                ? `${progress.current} / ${progress.total}`
                : "0 / ?"}
            </p>
          </>
        )}

        {step === "done" && result && (
          <>
            <h3 className="mb-3 text-sm font-semibold text-emerald-400">
              Import Complete
            </h3>
            <div className="space-y-2 text-sm">
              {result.installed.length > 0 && (
                <p className="text-[var(--text-primary)]">
                  <span className="font-medium text-emerald-400">
                    {result.installed.length} installed:
                  </span>{" "}
                  {result.installed.join(", ")}
                </p>
              )}
              {result.skipped.length > 0 && (
                <p className="text-[var(--text-secondary)]">
                  <span className="font-medium">
                    {result.skipped.length} skipped (already installed):
                  </span>{" "}
                  {result.skipped.join(", ")}
                </p>
              )}
              {result.failed.length > 0 && (
                <p className="text-red-400">
                  <span className="font-medium">
                    {result.failed.length} failed:
                  </span>{" "}
                  {result.failed
                    .map((f) => `${f.dir_name} (${f.error})`)
                    .join(", ")}
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleDone}
                className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
