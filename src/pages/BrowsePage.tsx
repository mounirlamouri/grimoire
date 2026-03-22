import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { InstalledAddon, CatalogAddon, CatalogStatus, InstallResult } from "../types/addon";
import { CatalogCard } from "../components/CatalogCard";

const PAGE_SIZE = 50;

export function BrowsePage({
  onError,
  onSuccess,
  onSync,
  syncing,
}: {
  onError: (msg: string) => void;
  onSuccess: (msg: { message: string; details: string | null }) => void;
  onSync: () => void;
  syncing: boolean;
}) {
  const [addons, setAddons] = useState<CatalogAddon[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [page, setPage] = useState(0);
  const [installedDirs, setInstalledDirs] = useState<Set<string>>(new Set());
  const [showLibraries, setShowLibraries] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await invoke<CatalogStatus>("get_catalog_status");
      setStatus(s);
      return s;
    } catch (err) {
      onError(`Failed to get catalog status: ${err}`);
      return null;
    }
  }, [onError]);

  const loadInstalledDirs = useCallback(async () => {
    try {
      const installed = await invoke<InstalledAddon[]>("get_installed_addons");
      setInstalledDirs(new Set(installed.map((a) => a.dir_name)));
    } catch {
      // Non-critical — just won't show installed badges
    }
  }, []);

  const loadAddons = useCallback(
    async (q: string, pageNum: number) => {
      setLoading(true);
      try {
        const results = await invoke<CatalogAddon[]>("search_addons", {
          query: q,
          limit: PAGE_SIZE,
          offset: pageNum * PAGE_SIZE,
        });
        setAddons(results);
      } catch (err) {
        onError(`Failed to load catalog: ${err}`);
      } finally {
        setLoading(false);
      }
    },
    [onError]
  );

  // Load on mount and when syncing finishes
  useEffect(() => {
    loadInstalledDirs();
    loadStatus().then(() => loadAddons(query, page));
  }, [syncing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when query or page changes
  useEffect(() => {
    const timer = setTimeout(() => {
      loadAddons(query, page);
    }, 300); // debounce search
    return () => clearTimeout(timer);
  }, [query, page, loadAddons]);

  const handleInstall = async (uid: string) => {
    try {
      const result = await invoke<InstallResult>("install_addon", { uid });
      loadInstalledDirs();
      const errors: string[] = [];
      if (result.missing_deps.length > 0) {
        errors.push(
          `Some required dependencies could not be found on ESOUI: ${result.missing_deps.join(", ")}`
        );
      }
      if (result.failed_deps.length > 0) {
        errors.push(
          `Failed to install some dependencies: ${result.failed_deps.map((d) => `${d.dir_name} (${d.error})`).join(", ")}`
        );
      }
      if (errors.length > 0) {
        if (result.auto_installed_deps.length > 0) {
          errors.push(`Automatically installed dependencies: ${result.auto_installed_deps.map((d) => d.name).join(", ")}`);
        }
        onError(`The addon was installed successfully, but it may not function properly because some dependencies could not be installed.\n\n${errors.join("\n\n")}`);
      } else {
        const deps = result.auto_installed_deps;
        onSuccess({
          message: "The addon was installed successfully.",
          details: deps.length > 0 ? `Automatically installed dependencies: ${deps.map((d) => d.name).join(", ")}` : null,
        });
      }
    } catch (err) {
      onError(`Install failed: ${err}`);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const filtered = showLibraries ? addons : addons.filter((a) => !a.is_library);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Browse Addons</h2>
          {status && (
            <span className="text-xs text-[var(--text-secondary)]">
              {status.addon_count.toLocaleString()} addons
              {status.last_sync && (
                <span className="ml-1">
                  — last synced {formatDate(status.last_sync)}
                </span>
              )}
            </span>
          )}
        </div>
        <button
          onClick={onSync}
          disabled={syncing}
          className="rounded border border-[var(--teal)]/30 px-3 py-1.5 text-sm text-[var(--teal)] transition hover:bg-[var(--teal)]/10 disabled:opacity-50"
        >
          {syncing ? "Syncing..." : "Force Sync"}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder="Search addons by name or author..."
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

      {loading && filtered.length === 0 ? (
        <p className="text-[var(--text-secondary)]">Loading catalog...</p>
      ) : filtered.length === 0 ? (
        <p className="text-[var(--text-secondary)]">
          {status?.addon_count === 0
            ? "Catalog is empty. Click 'Force Sync' to fetch the addon list."
            : "No addons match your search."}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {filtered.map((addon) => (
              <CatalogCard
                key={addon.uid}
                addon={addon}
                installed={
                  addon.directories
                    ? addon.directories.split(",").some((d) => installedDirs.has(d.trim()))
                    : false
                }
                onInstall={handleInstall}
              />
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border border-[var(--teal-dim)]/30 px-3 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-xs text-[var(--text-secondary)]">
              Page {page + 1}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={filtered.length < PAGE_SIZE}
              className="rounded border border-[var(--teal-dim)]/30 px-3 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
