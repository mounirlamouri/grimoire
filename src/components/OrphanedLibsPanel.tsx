import { useState } from "react";
import type { InstalledAddon } from "../types/addon";

export function OrphanedLibsPanel({
  libraries,
  onUninstall,
  onUninstallAll,
  onClose,
}: {
  libraries: InstalledAddon[];
  onUninstall: (dirName: string) => Promise<void>;
  onUninstallAll: () => Promise<void>;
  onClose: () => void;
}) {
  const [removingAll, setRemovingAll] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  if (libraries.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--teal-dim)]/30 bg-[var(--bg-card)] p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--text-secondary)]">
            No orphaned libraries found — all libraries are in use.
          </p>
          <button
            onClick={onClose}
            className="text-xs text-[var(--text-secondary)] transition hover:text-white"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-yellow-400">
            Orphaned Libraries ({libraries.length})
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            These libraries are not required by any installed addon and can be safely removed.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded border border-[var(--teal-dim)]/30 px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-white/5"
          >
            Dismiss
          </button>
          <button
            onClick={async () => {
              setRemovingAll(true);
              await onUninstallAll();
              setRemovingAll(false);
            }}
            disabled={removingAll}
            className="rounded bg-red-500 px-3 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {removingAll ? "Uninstalling..." : "Uninstall All"}
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {libraries.map((lib) => (
          <div
            key={lib.dir_name}
            className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-white/5"
          >
            <div className="flex items-center gap-2">
              <span>{lib.title}</span>
              {lib.author && (
                <span className="text-[var(--text-secondary)]">by {lib.author}</span>
              )}
            </div>
            <button
              onClick={async () => {
                setRemoving(lib.dir_name);
                await onUninstall(lib.dir_name);
                setRemoving(null);
              }}
              disabled={removing === lib.dir_name || removingAll}
              className="rounded border border-red-500/30 px-2 py-0.5 text-xs text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              {removing === lib.dir_name ? "Uninstalling..." : "Uninstall"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
