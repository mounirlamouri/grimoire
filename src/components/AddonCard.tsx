import { useState, useEffect } from "react";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { InstalledAddon, AddonUpdate, AddonMetadata, CompatibilityEntry } from "../types/addon";
import { getStaleness } from "../utils/staleness";
import { formatRelativeDate } from "../utils/formatDate";
import { ExternalLinkIcon } from "./ExternalLinkIcon";
import { FolderIcon } from "./FolderIcon";
import { BBCodeDescription } from "./BBCodeDescription";

export function AddonCard({
  addon,
  update,
  missingDeps,
  catalogDate,
  fileInfoUrl,
  addonPath,
  stalenessWarningDays,
  stalenessErrorDays,
  hideStalenessWarnings,
  onUninstall,
  onUpdate,
  onFixDeps,
  metadata,
  metadataLoading,
  onExpand,
}: {
  addon: InstalledAddon;
  update?: AddonUpdate;
  missingDeps?: { fixable: string[]; unavailable: string[] };
  catalogDate?: number | null;
  fileInfoUrl?: string | null;
  addonPath?: string | null;
  stalenessWarningDays: number;
  stalenessErrorDays: number;
  hideStalenessWarnings: boolean;
  onUninstall: (dirName: string) => Promise<void>;
  onUpdate: (uid: string) => Promise<void>;
  onFixDeps: (dirNames: string[]) => Promise<void>;
  metadata?: AddonMetadata;
  metadataLoading?: boolean;
  onExpand?: (dirName: string) => void;
}) {
  const staleness = hideStalenessWarnings
    ? null
    : getStaleness(catalogDate, stalenessWarningDays, stalenessErrorDays);
  const [expanded, setExpanded] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);

  useEffect(() => {
    if (expanded && onExpand) {
      onExpand(addon.dir_name);
    }
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUninstall = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingUninstall(true);
  };

  const doUninstall = async () => {
    setConfirmingUninstall(false);
    setUninstalling(true);
    try {
      await onUninstall(addon.dir_name);
    } finally {
      setUninstalling(false);
    }
  };

  const hasMissingDeps = missingDeps && (missingDeps.fixable.length > 0 || missingDeps.unavailable.length > 0);

  return (
    <div
      className={`rounded-lg border bg-[var(--bg-card)] p-3 transition hover:border-[var(--teal-dim)]/40 ${
        hasMissingDeps || staleness === "error"
          ? "border-red-500/20"
          : staleness === "warning"
            ? "border-yellow-500/20"
            : update
              ? "border-[var(--accent)]/30"
              : "border-[var(--teal-dim)]/20"
      }`}
    >
      <div className="flex cursor-pointer items-start justify-between" onClick={() => setExpanded(!expanded)}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{addon.title}</span>
            {addon.is_library && (
              <span className="rounded bg-[var(--teal-dim)]/30 px-1.5 py-0.5 text-[10px] font-medium text-[var(--teal)]">
                LIB
              </span>
            )}
            {update && (
              <span className="rounded bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                UPDATE
              </span>
            )}
            {hasMissingDeps && (
              <span
                className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
                title={`Missing dependencies: ${[...missingDeps!.fixable, ...missingDeps!.unavailable].join(", ")}`}
              >
                MISSING DEPS
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
            {addon.version && <span>v{addon.version}</span>}
            {update && (
              <span className="text-[var(--teal)]">→ v{update.latest_version}</span>
            )}
            {catalogDate != null && (
              <span title={new Date(catalogDate).toLocaleDateString()}>
                Updated {formatRelativeDate(catalogDate)}
              </span>
            )}
          </div>
        </div>
        <div className="ml-3 flex shrink-0 gap-2">
          {update && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                setUpdating(true);
                try {
                  await onUpdate(update.uid);
                } finally {
                  setUpdating(false);
                }
              }}
              disabled={updating}
              className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {updating ? "Updating..." : "Update"}
            </button>
          )}
          {missingDeps && missingDeps.fixable.length > 0 && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                setFixing(true);
                try {
                  await onFixDeps(missingDeps.fixable);
                } finally {
                  setFixing(false);
                }
              }}
              disabled={fixing}
              className="rounded bg-red-500 px-3 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {fixing ? "Fixing..." : "Fix"}
            </button>
          )}
          <button
            onClick={handleUninstall}
            disabled={uninstalling}
            className="rounded border border-red-500/30 px-3 py-1 text-xs font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
          >
            {uninstalling ? "Removing..." : "Uninstall"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 max-h-[400px] overflow-y-auto space-y-2 border-t border-white/5 pt-3 text-xs">
          {metadataLoading && !metadata && (
            <p className="text-[var(--text-secondary)] animate-pulse">Loading details...</p>
          )}
          {metadata?.description ? (
            <BBCodeDescription text={metadata.description} />
          ) : addon.description ? (
            <p className="text-[var(--text-secondary)]">{addon.description}</p>
          ) : null}
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
            {addonPath ? (
              <button
                onClick={() => revealItemInDir(`${addonPath}/${addon.dir_name}`).catch(() => {})}
                className="inline-flex cursor-pointer items-center gap-1 text-[var(--teal)] hover:underline"
                aria-label={`Open ${addon.dir_name} folder`}
              >
                <FolderIcon />
                {addon.dir_name}
              </button>
            ) : (
              <span>{addon.dir_name}</span>
            )}
            {addon.addon_version != null && (
              <span>AddOnVersion: {addon.addon_version}</span>
            )}
            {addon.api_versions.length > 0 && (
              <span>API: {addon.api_versions.join(", ")}</span>
            )}
            {fileInfoUrl && (
              <button
                onClick={() => openUrl(fileInfoUrl).catch(() => {})}
                className="inline-flex cursor-pointer items-center gap-1 text-[var(--teal)] hover:underline"
              >
                <ExternalLinkIcon />
                ESOUI Page
              </button>
            )}
            {metadata?.donation_link && (
              <button
                onClick={() => openUrl(metadata.donation_link!).catch(() => {})}
                className="inline-flex cursor-pointer items-center gap-1 text-[var(--accent)] hover:underline"
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
                        alt={`Screenshot ${i + 1}`}
                        className="h-16 w-auto rounded border border-white/10 cursor-pointer hover:border-[var(--teal)]/50 transition"
                        onClick={() => openUrl(fullImgs[i] || thumb).catch(() => {})}
                      />
                    ))}
                  </div>
                );
              }
            } catch { /* ignore parse errors */ }
            return null;
          })()}
          {addon.depends_on.length > 0 && (
            <div>
              <span className="text-[var(--text-secondary)]">Depends on: </span>
              <span className="text-[var(--teal)]">
                {addon.depends_on
                  .map((d) =>
                    d.min_version ? `${d.name} (>=${d.min_version})` : d.name
                  )
                  .join(", ")}
              </span>
            </div>
          )}
          {missingDeps && missingDeps.fixable.length > 0 && (
            <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2">
              <p className="text-xs text-red-400">
                Missing dependencies: {missingDeps.fixable.join(", ")}. This addon may not function properly.
                Click Fix to install them automatically.
              </p>
            </div>
          )}
          {missingDeps && missingDeps.unavailable.length > 0 && (
            <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2">
              <p className="text-xs text-red-400">
                Missing dependencies not available on ESOUI: {missingDeps.unavailable.join(", ")}. These may have been removed or renamed.
              </p>
            </div>
          )}
          {staleness && (
            <div className={`rounded border px-3 py-2 ${staleness === "error" ? "border-red-500/20 bg-red-500/5" : "border-yellow-500/20 bg-yellow-500/5"}`}>
              <p className={`text-xs ${staleness === "error" ? "text-red-400" : "text-yellow-400"}`}>
                This addon has not been updated on ESOUI in over {staleness === "error" ? stalenessErrorDays : stalenessWarningDays} days. It may no longer work with the current version of ESO.
              </p>
            </div>
          )}
        </div>
      )}

      {confirmingUninstall && (
        <div
          className="mt-3 flex items-center justify-between rounded border border-red-500/30 bg-red-500/5 p-3"
        >
          <span className="text-sm text-[var(--text-primary)]">
            Uninstall <strong>{addon.title}</strong>?
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmingUninstall(false)}
              className="rounded border border-[var(--teal-dim)]/30 px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={doUninstall}
              className="rounded bg-red-500 px-3 py-1 text-xs font-medium text-white transition hover:brightness-110"
            >
              Uninstall
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
