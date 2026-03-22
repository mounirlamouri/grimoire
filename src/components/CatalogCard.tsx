import { useState } from "react";
import type { CatalogAddon } from "../types/addon";

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function CatalogCard({
  addon,
  installed,
  onInstall,
}: {
  addon: CatalogAddon;
  installed: boolean;
  onInstall: (uid: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [installing, setInstalling] = useState(false);

  const handleInstall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setInstalling(true);
    try {
      await onInstall(addon.uid);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      className="cursor-pointer rounded-lg border border-[var(--teal-dim)]/20 bg-[var(--bg-card)] p-3 transition hover:border-[var(--teal-dim)]/40"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{addon.name}</span>
            {addon.version && (
              <span className="text-xs text-[var(--text-secondary)]">
                v{addon.version}
              </span>
            )}
            {addon.is_library && (
              <span className="rounded bg-[var(--teal-dim)]/30 px-1.5 py-0.5 text-[10px] font-medium text-[var(--teal)]">
                LIB
              </span>
            )}
            {installed && (
              <span className="rounded bg-[var(--teal)]/20 px-1.5 py-0.5 text-[10px] font-medium text-[var(--teal)]">
                INSTALLED
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            {addon.author && <span>by {addon.author}</span>}
            <span>{formatNumber(addon.downloads)} downloads</span>
            {addon.favorites > 0 && (
              <span>{formatNumber(addon.favorites)} favorites</span>
            )}
          </div>
        </div>
        {!installed && (
          <button
            onClick={handleInstall}
            disabled={installing}
            className="ml-3 shrink-0 rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {installing ? "Installing..." : "Install"}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-white/5 pt-3 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-secondary)]">
            {addon.directories && <span>Folders: {addon.directories}</span>}
            {addon.downloads_monthly > 0 && (
              <span>Monthly: {formatNumber(addon.downloads_monthly)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
