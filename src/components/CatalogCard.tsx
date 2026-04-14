import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CatalogAddon, AddonMetadata, CompatibilityEntry } from "../types/addon";
import { getStaleness } from "../utils/staleness";
import { formatRelativeDate } from "../utils/formatDate";
import { ExternalLinkIcon } from "./ExternalLinkIcon";
import { BBCodeDescription } from "./BBCodeDescription";

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function CatalogCard({
  addon,
  installed,
  stalenessWarningDays,
  stalenessErrorDays,
  hideStalenessWarnings,
  onInstall,
  metadata,
  metadataLoading,
  onExpand,
}: {
  addon: CatalogAddon;
  installed: boolean;
  stalenessWarningDays: number;
  stalenessErrorDays: number;
  hideStalenessWarnings: boolean;
  onInstall: (uid: string) => Promise<void>;
  metadata?: AddonMetadata;
  metadataLoading?: boolean;
  onExpand?: (uid: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (expanded && onExpand) {
      onExpand(addon.uid);
    }
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const staleness = hideStalenessWarnings
    ? null
    : getStaleness(addon.date, stalenessWarningDays, stalenessErrorDays);

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
      className={`cursor-pointer rounded-lg border bg-[var(--bg-card)] p-3 transition hover:border-[var(--teal-dim)]/40 ${
        staleness === "error"
          ? "border-red-500/20"
          : staleness === "warning"
            ? "border-yellow-500/20"
            : "border-[var(--teal-dim)]/20"
      }`}
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
            {staleness && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${staleness === "error" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}
                title={`Not updated on ESOUI in over ${staleness === "error" ? stalenessErrorDays : stalenessWarningDays} days — may no longer work`}
              >
                STALE
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            {addon.author && <span>by {addon.author}</span>}
            <span>{formatNumber(addon.downloads)} downloads</span>
            {addon.favorites > 0 && (
              <span>{formatNumber(addon.favorites)} favorites</span>
            )}
            {addon.date != null && (
              <span title={new Date(addon.date).toLocaleDateString()}>
                Updated {formatRelativeDate(addon.date)}
              </span>
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
        <div className="mt-3 max-h-[400px] overflow-y-auto space-y-2 border-t border-white/5 pt-3 text-xs">
          {metadataLoading && !metadata && (
            <p className="text-[var(--text-secondary)] animate-pulse">Loading details...</p>
          )}
          {metadata?.description && (
            <BBCodeDescription text={metadata.description} />
          )}
          {metadata?.compatibility && (() => {
            try {
              const entries: CompatibilityEntry[] = JSON.parse(metadata.compatibility!);
              if (entries.length > 0) {
                return (
                  <div className="flex flex-wrap gap-1">
                    {entries.map((c) => (
                      <span
                        key={c.version}
                        className="rounded bg-[var(--teal-dim)]/20 px-1.5 py-0.5 text-[10px] text-[var(--teal)]"
                      >
                        {c.name || c.version}
                      </span>
                    ))}
                  </div>
                );
              }
            } catch { /* ignore parse errors */ }
            return null;
          })()}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-secondary)]">
            {addon.downloads_monthly > 0 && (
              <span>Monthly: {formatNumber(addon.downloads_monthly)}</span>
            )}
            {addon.file_info_url && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openUrl(addon.file_info_url!).catch(() => {});
                }}
                className="inline-flex items-center gap-1 text-[var(--teal)] hover:underline"
              >
                <ExternalLinkIcon />
                ESOUI Page
              </button>
            )}
            {metadata?.donation_link && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openUrl(metadata.donation_link!).catch(() => {});
                }}
                className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
              >
                Support Author
              </button>
            )}
          </div>
          {metadata?.img_thumbs && (() => {
            try {
              const thumbs: string[] = JSON.parse(metadata.img_thumbs!);
              if (thumbs.length > 0) {
                const fullImgs: string[] = metadata.imgs ? JSON.parse(metadata.imgs) : thumbs;
                return (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {thumbs.map((thumb, i) => (
                      <img
                        key={thumb}
                        src={thumb}
                        alt="Screenshot"
                        className="h-16 w-auto rounded border border-white/10 cursor-pointer hover:border-[var(--teal)]/50 transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          openUrl(fullImgs[i] || thumb).catch(() => {});
                        }}
                      />
                    ))}
                  </div>
                );
              }
            } catch { /* ignore parse errors */ }
            return null;
          })()}
          {staleness && (
            <div className={`rounded border px-3 py-2 ${staleness === "error" ? "border-red-500/20 bg-red-500/5" : "border-yellow-500/20 bg-yellow-500/5"}`}>
              <p className={`text-xs ${staleness === "error" ? "text-red-400" : "text-yellow-400"}`}>
                This addon has not been updated on ESOUI in over {staleness === "error" ? stalenessErrorDays : stalenessWarningDays} days. It may no longer work with the current version of ESO.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
