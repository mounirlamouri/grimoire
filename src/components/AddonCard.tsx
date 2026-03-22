import { useState } from "react";
import type { InstalledAddon, AddonUpdate } from "../types/addon";

export function AddonCard({
  addon,
  update,
  missingDeps,
  onUninstall,
  onUpdate,
  onFixDeps,
}: {
  addon: InstalledAddon;
  update?: AddonUpdate;
  missingDeps?: { fixable: string[]; unavailable: string[] };
  onUninstall: (dirName: string) => Promise<void>;
  onUpdate: (uid: string) => Promise<void>;
  onFixDeps: (dirNames: string[]) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);

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

  return (
    <div
      className={`cursor-pointer rounded-lg border p-3 transition hover:border-[var(--teal-dim)]/40 ${
        missingDeps && (missingDeps.fixable.length > 0 || missingDeps.unavailable.length > 0)
          ? "border-red-500/20 bg-[var(--bg-card)]"
          : update && !update.version_mismatch
            ? "border-[var(--accent)]/30 bg-[var(--bg-card)]"
            : update?.version_mismatch
              ? "border-yellow-500/20 bg-[var(--bg-card)]"
              : "border-[var(--teal-dim)]/20 bg-[var(--bg-card)]"
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{addon.title}</span>
            {addon.is_library && (
              <span className="rounded bg-[var(--teal-dim)]/30 px-1.5 py-0.5 text-[10px] font-medium text-[var(--teal)]">
                LIB
              </span>
            )}
            {update && !update.version_mismatch && (
              <span className="rounded bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                UPDATE
              </span>
            )}
            {missingDeps && (missingDeps.fixable.length > 0 || missingDeps.unavailable.length > 0) && (
              <span
                className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
                title={`Missing dependencies: ${[...missingDeps.fixable, ...missingDeps.unavailable].join(", ")}`}
              >
                MISSING DEPS
              </span>
            )}
            {update?.version_mismatch && (
              <span
                className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400"
                title="This addon reports a different version than ESOUI. You have the latest files — this is a packaging issue by the addon author."
              >
                VERSION MISMATCH
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            {addon.author && <span>by {addon.author}</span>}
            {addon.version && <span>v{addon.version}</span>}
            {update && !update.version_mismatch && (
              <span className="text-[var(--teal)]">→ v{update.latest_version}</span>
            )}
          </div>
        </div>
        <div className="ml-3 flex shrink-0 gap-2">
          {update && !update.version_mismatch && (
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
        <div className="mt-3 space-y-2 border-t border-white/5 pt-3 text-xs">
          {addon.description && (
            <p className="text-[var(--text-secondary)]">{addon.description}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--text-secondary)]">
            <span>Folder: {addon.dir_name}</span>
            {addon.addon_version != null && (
              <span>AddOnVersion: {addon.addon_version}</span>
            )}
            {addon.api_versions.length > 0 && (
              <span>API: {addon.api_versions.join(", ")}</span>
            )}
          </div>
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
          {update?.version_mismatch && (
            <div className="rounded border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
              <p className="text-xs text-yellow-400">
                Version mismatch: this addon reports v{update.installed_version} but
                ESOUI lists v{update.latest_version}. This can happen when the addon author
                uses a different versioning scheme on ESOUI than in the addon files, or forgot
                to update the version in the manifest. You have the latest version.
              </p>
            </div>
          )}
        </div>
      )}

      {confirmingUninstall && (
        <div
          className="mt-3 flex items-center justify-between rounded border border-red-500/30 bg-red-500/5 p-3"
          onClick={(e) => e.stopPropagation()}
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
