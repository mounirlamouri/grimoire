import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InstalledAddon } from "../types/addon";

export function ExportModal({
  addons,
  onClose,
  onError,
}: {
  addons: InstalledAddon[];
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const libraries = addons.filter((a) => a.is_library);
  const nonLibraries = addons.filter((a) => !a.is_library);

  const [selected, setSelected] = useState<Set<string>>(() => {
    return new Set(nonLibraries.map((a) => a.dir_name));
  });
  const [exporting, setExporting] = useState(false);
  const [pasteUrl, setPasteUrl] = useState<string | null>(null);
  const [copiedList, setCopiedList] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const toggle = (dirName: string) => {
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

  const selectAll = () => {
    setSelected(new Set(addons.map((a) => a.dir_name)));
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  const getExportText = async () => {
    const dirNames = addons
      .filter((a) => selected.has(a.dir_name))
      .map((a) => a.dir_name);
    return invoke<string>("export_addon_list", { dirNames });
  };

  const handleCopyToClipboard = async () => {
    try {
      const text = await getExportText();
      await navigator.clipboard.writeText(text);
      setCopiedList(true);
      setTimeout(() => setCopiedList(false), 2000);
    } catch (err) {
      onError(`Export failed: ${err}`);
    }
  };

  const handleUploadToPaste = async () => {
    setExporting(true);
    try {
      const text = await getExportText();
      const url = await invoke<string>("upload_to_paste", { content: text });
      setPasteUrl(url);
    } catch (err) {
      onError(`Upload failed: ${err}`);
    } finally {
      setExporting(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!pasteUrl) return;
    try {
      await navigator.clipboard.writeText(pasteUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (err) {
      onError(`Failed to copy URL: ${err}`);
    }
  };

  const selectedCount = selected.size;

  const renderAddonList = (list: InstalledAddon[], label: string) => {
    if (list.length === 0) return null;
    return (
      <>
        <p className="mt-3 mb-1 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
          {label} ({list.filter((a) => selected.has(a.dir_name)).length}/{list.length})
        </p>
        <div className="space-y-0.5">
          {list.map((addon) => (
            <label
              key={addon.dir_name}
              className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-white/5 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(addon.dir_name)}
                onChange={() => toggle(addon.dir_name)}
                className="accent-[var(--teal)]"
              />
              <span className="text-[var(--text-primary)]">{addon.title}</span>
              <span className="text-xs text-[var(--text-secondary)]">
                {addon.dir_name}
              </span>
            </label>
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-[var(--teal-dim)]/40 bg-[var(--bg-secondary)] p-5 shadow-xl">
        <h3 className="mb-3 text-sm font-semibold text-[var(--accent)]">
          Export Addon List
        </h3>

        {pasteUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-primary)]">
              Your addon list has been uploaded successfully.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={pasteUrl}
                readOnly
                className="flex-1 rounded border border-[var(--teal-dim)]/30 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--teal)] font-mono select-all"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={handleCopyUrl}
                className="rounded bg-[var(--teal)] px-3 py-2 text-sm font-medium text-white transition hover:brightness-110"
              >
                {copiedUrl ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Share this link so others can import your addon list.
            </p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded border border-[var(--teal-dim)]/30 px-4 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-xs text-[var(--teal)] hover:underline"
              >
                Select all
              </button>
              <span className="text-xs text-[var(--text-secondary)]">/</span>
              <button
                onClick={deselectAll}
                className="text-xs text-[var(--teal)] hover:underline"
              >
                Deselect all
              </button>
              <span className="ml-auto text-xs text-[var(--text-secondary)]">
                {selectedCount} selected
              </span>
            </div>

            <div className="max-h-80 overflow-auto rounded border border-white/10 bg-[var(--bg-primary)] p-2">
              {renderAddonList(nonLibraries, "Addons")}
              {renderAddonList(libraries, "Libraries")}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={onClose}
                className="rounded border border-[var(--teal-dim)]/30 px-4 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleCopyToClipboard}
                  disabled={selectedCount === 0}
                  className="rounded border border-[var(--teal)]/30 px-4 py-1.5 text-sm text-[var(--teal)] transition hover:bg-[var(--teal)]/10 disabled:opacity-50"
                >
                  {copiedList ? "Copied!" : "Copy to Clipboard"}
                </button>
                <button
                  onClick={handleUploadToPaste}
                  disabled={selectedCount === 0 || exporting}
                  className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {exporting ? "Uploading..." : "Upload to paste.rs"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
