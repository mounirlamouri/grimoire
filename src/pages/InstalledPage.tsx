import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InstalledAddon, AddonUpdate, InstallResult } from "../types/addon";
import { AddonCard } from "../components/AddonCard";
import { useStalenessSettings } from "../hooks/useStalenessSettings";
import { UpdatesBanner } from "../components/UpdatesBanner";
import { OrphanedLibsPanel } from "../components/OrphanedLibsPanel";
import { ExportModal } from "../components/ExportModal";
import { ImportModal } from "../components/ImportModal";

export function InstalledPage({
  onError,
  onSuccess,
  updates,
  onCheckUpdates,
  checking,
  onUpdateDone,
}: {
  onError: (msg: string) => void;
  onSuccess: (msg: { message: string; details: string | null }) => void;
  updates: AddonUpdate[];
  onCheckUpdates: () => void;
  checking: boolean;
  onUpdateDone: (uid: string) => void;
}) {
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showLibraries, setShowLibraries] = useState(false);
  const [orphanedLibs, setOrphanedLibs] = useState<InstalledAddon[] | null>(null);
  const [loadingOrphans, setLoadingOrphans] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [catalogDates, setCatalogDates] = useState<Record<string, number>>({});
  const [fileInfoUrls, setFileInfoUrls] = useState<Record<string, string>>({});
  const [addonPath, setAddonPath] = useState<string | null>(null);
  const { stalenessWarningDays, stalenessErrorDays, hideStalenessWarnings } = useStalenessSettings();

  const loadAddons = () => {
    setLoading(true);
    invoke<InstalledAddon[]>("get_installed_addons")
      .then((result) => {
        setAddons(result);
        setLoading(false);
      })
      .catch((err) => {
        onError(String(err));
        setLoading(false);
      });
  };

  const handleUninstall = async (dirName: string) => {
    try {
      await invoke("uninstall_addon", { dirName });
      loadAddons();
    } catch (err) {
      onError(`Uninstall failed: ${err}`);
    }
  };

  const handleUpdate = async (uid: string) => {
    try {
      const result = await invoke<InstallResult>("update_addon", { uid });
      onUpdateDone(uid);
      loadAddons();
      const errors: string[] = [];
      if (result.missing_deps.length > 0) {
        errors.push(`Some required dependencies could not be found on ESOUI: ${result.missing_deps.join(", ")}`);
      }
      if (result.failed_deps.length > 0) {
        errors.push(`Failed to install some dependencies: ${result.failed_deps.map((d) => `${d.dir_name} (${d.error})`).join(", ")}`);
      }
      if (errors.length > 0) {
        if (result.auto_installed_deps.length > 0) {
          errors.push(`Automatically installed dependencies: ${result.auto_installed_deps.map((d) => d.name).join(", ")}`);
        }
        onError(`The addon was updated successfully, but it may not function properly.\n\n${errors.join("\n\n")}`);
      } else {
        const deps = result.auto_installed_deps;
        onSuccess({
          message: "The addon was updated successfully.",
          details: deps.length > 0 ? `Automatically installed dependencies: ${deps.map((d) => d.name).join(", ")}` : null,
        });
      }
    } catch (err) {
      onError(`Update failed: ${err}`);
    }
  };

  const handleFixDeps = async (dirNames: string[]) => {
    try {
      const result = await invoke<InstallResult>("install_missing_deps", { dirNames });
      loadAddons();
      const errors: string[] = [];
      if (result.missing_deps.length > 0) {
        errors.push(`Could not be found on ESOUI: ${result.missing_deps.join(", ")}`);
      }
      if (result.failed_deps.length > 0) {
        errors.push(`Failed to install: ${result.failed_deps.map((d) => `${d.dir_name} (${d.error})`).join(", ")}`);
      }
      if (errors.length > 0) {
        if (result.auto_installed_deps.length > 0) {
          errors.push(`Automatically installed: ${result.auto_installed_deps.map((d) => d.name).join(", ")}`);
        }
        onError(`Some dependencies could not be installed.\n\n${errors.join("\n\n")}`);
      } else {
        onSuccess({
          message: "All missing dependencies were installed successfully.",
          details: result.auto_installed_deps.length > 0
            ? `Installed: ${result.auto_installed_deps.map((d) => d.name).join(", ")}`
            : null,
        });
      }
    } catch (err) {
      onError(`Failed to install dependencies: ${err}`);
    }
  };

  const scanOrphanedLibs = async () => {
    setLoadingOrphans(true);
    try {
      const libs = await invoke<InstalledAddon[]>("find_orphaned_libraries");
      setOrphanedLibs(libs);
    } catch (err) {
      onError(`Failed to scan libraries: ${err}`);
    } finally {
      setLoadingOrphans(false);
    }
  };

  const handleUninstallOrphan = async (dirName: string) => {
    try {
      await invoke("uninstall_addon", { dirName });
      setOrphanedLibs((prev) => prev?.filter((l) => l.dir_name !== dirName) ?? null);
      loadAddons();
    } catch (err) {
      onError(`Uninstall failed: ${err}`);
    }
  };

  const handleUninstallAllOrphans = async () => {
    if (!orphanedLibs) return;
    let failed = 0;
    for (const lib of orphanedLibs) {
      try {
        await invoke("uninstall_addon", { dirName: lib.dir_name });
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      onError(`${failed} library${failed !== 1 ? "ies" : ""} failed to uninstall.`);
    }
    setOrphanedLibs(null);
    loadAddons();
  };

  useEffect(() => {
    loadAddons();
    invoke<string | null>("get_addon_path").then(setAddonPath).catch(() => {});
  }, []);

  useEffect(() => {
    if (addons.length === 0) return;
    const dirNames = addons.map((a) => a.dir_name);
    invoke<Record<string, number>>("get_catalog_dates", { dirNames })
      .then(setCatalogDates)
      .catch(() => {});
    invoke<Record<string, string>>("get_file_info_urls", { dirNames })
      .then(setFileInfoUrls)
      .catch(() => {});
  }, [addons]);

  const updateMap = new Map(updates.map((u) => [u.dir_name, u]));

  // Compute missing dependencies and check catalog availability
  const [missingDepsMap, setMissingDepsMap] = useState<Map<string, { fixable: string[]; unavailable: string[] }>>(new Map());
  useEffect(() => {
    const installedDirNames = new Set(addons.map((a) => a.dir_name));
    const allMissing = new Map<string, string[]>();
    const allMissingNames = new Set<string>();
    for (const addon of addons) {
      const missing = addon.depends_on
        .map((d) => d.name)
        .filter((name) => !installedDirNames.has(name));
      if (missing.length > 0) {
        allMissing.set(addon.dir_name, missing);
        missing.forEach((n) => allMissingNames.add(n));
      }
    }
    if (allMissingNames.size === 0) {
      setMissingDepsMap(new Map());
      return;
    }
    invoke<string[]>("check_catalog_availability", { dirNames: [...allMissingNames] })
      .then((available) => {
        const availableSet = new Set(available);
        const result = new Map<string, { fixable: string[]; unavailable: string[] }>();
        for (const [dirName, missing] of allMissing) {
          const fixable = missing.filter((n) => availableSet.has(n));
          const unavailable = missing.filter((n) => !availableSet.has(n));
          result.set(dirName, { fixable, unavailable });
        }
        setMissingDepsMap(result);
      })
      .catch(() => {
        const result = new Map<string, { fixable: string[]; unavailable: string[] }>();
        for (const [dirName, missing] of allMissing) {
          result.set(dirName, { fixable: [], unavailable: missing });
        }
        setMissingDepsMap(result);
      });
  }, [addons]);

  const filtered = addons.filter((addon) => {
    if (!showLibraries && addon.is_library) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      addon.title.toLowerCase().includes(q) ||
      addon.author.toLowerCase().includes(q) ||
      addon.dir_name.toLowerCase().includes(q)
    );
  });

  const addonCount = addons.filter((a) => !a.is_library).length;
  const libCount = addons.filter((a) => a.is_library).length;

  return (
    <div className="space-y-4">
      {showExport && (
        <ExportModal
          addons={addons}
          onClose={() => setShowExport(false)}
          onError={onError}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onError={onError}
          onDone={loadAddons}
        />
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Installed Addons</h2>
          {!loading && (
            <span className="text-xs text-[var(--text-secondary)]">
              {addonCount} addons, {libCount} libraries
              {updates.length > 0 && (
                <span className="ml-1 text-[var(--accent)]">
                  ({updates.length} update{updates.length !== 1 ? "s" : ""})
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExport(true)}
            disabled={loading || addons.length === 0}
            className="rounded border border-[var(--teal-dim)]/30 px-3 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white disabled:opacity-50"
          >
            Export
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="rounded border border-[var(--teal-dim)]/30 px-3 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white"
          >
            Import
          </button>
          <button
            onClick={loadAddons}
            className="rounded border border-[var(--teal-dim)]/30 px-3 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white"
          >
            Refresh
          </button>
          <button
            onClick={scanOrphanedLibs}
            disabled={loadingOrphans || loading}
            className="rounded border border-yellow-500/30 px-3 py-1.5 text-sm text-yellow-400 transition hover:bg-yellow-500/10 disabled:opacity-50"
          >
            {loadingOrphans ? "Scanning..." : "Clean Up Libraries"}
          </button>
          <button
            onClick={onCheckUpdates}
            disabled={checking || loading}
            className="rounded border border-[var(--teal)]/30 px-3 py-1.5 text-sm text-[var(--teal)] transition hover:bg-[var(--teal)]/10 disabled:opacity-50"
          >
            {checking ? "Checking..." : "Check for Updates"}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--text-secondary)]">Scanning addons...</p>
      ) : (
        <>
          {updates.length > 0 && (
            <UpdatesBanner updates={updates} onUpdate={handleUpdate} onError={onError} onDone={loadAddons} />
          )}

          {orphanedLibs !== null && (
            <OrphanedLibsPanel
              libraries={orphanedLibs}
              onUninstall={handleUninstallOrphan}
              onUninstallAll={handleUninstallAllOrphans}
              onClose={() => setOrphanedLibs(null)}
            />
          )}

          <div className="flex items-center gap-3">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter addons..."
              className="flex-1 rounded border border-[var(--teal-dim)]/30 bg-[var(--bg-secondary)] px-3 py-2 text-sm text-white placeholder:text-[var(--text-secondary)]"
            />
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={showLibraries}
                onChange={(e) => setShowLibraries(e.target.checked)}
                className="accent-[var(--teal)]"
              />
              Show libraries
            </label>
          </div>

          {filtered.length === 0 ? (
            <p className="text-[var(--text-secondary)]">
              {addons.length === 0
                ? "No addons found in the AddOns folder."
                : "No addons match your filter."}
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((addon) => (
                <AddonCard
                  key={addon.dir_name}
                  addon={addon}
                  update={updateMap.get(addon.dir_name)}
                  missingDeps={missingDepsMap.get(addon.dir_name) ?? undefined}
                  catalogDate={catalogDates[addon.dir_name] ?? null}
                  fileInfoUrl={fileInfoUrls[addon.dir_name] ?? null}
                  addonPath={addonPath}
                  stalenessWarningDays={stalenessWarningDays}
                  stalenessErrorDays={stalenessErrorDays}
                  hideStalenessWarnings={hideStalenessWarnings}
                  onUninstall={handleUninstall}
                  onUpdate={handleUpdate}
                  onFixDeps={handleFixDeps}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
