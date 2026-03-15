import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  InstalledAddon,
  AddonUpdate,
  CatalogAddon,
  CatalogStatus,
  SyncProgress,
} from "./types/addon";

type Tab = "installed" | "browse" | "settings";

function ErrorOverlay({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  // Split into summary (first line / before colon chain) and details
  const colonIdx = message.indexOf(": ");
  const summary = colonIdx > 0 ? message.slice(0, colonIdx) : message;
  const details = colonIdx > 0 ? message : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 max-w-lg rounded-lg border border-[var(--accent)]/40 bg-[var(--bg-secondary)] p-5 shadow-xl">
        <h3 className="mb-2 text-sm font-semibold text-[var(--accent)]">Error</h3>
        <p className="mb-3 text-sm text-[var(--text-primary)]">{summary}</p>
        {details && (
          <>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="mb-3 text-xs text-[var(--text-secondary)] underline transition hover:text-white"
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>
            {showDetails && (
              <pre className="mb-3 max-h-48 overflow-auto rounded border border-white/10 bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)]">
                {message}
              </pre>
            )}
          </>
        )}
        <div>
          <button
            onClick={onClose}
            className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function SyncModal({ progress }: { progress: SyncProgress | null }) {
  const pct = progress ? Math.max(0, Math.min(100, progress.progress * 100)) : 0;
  const isIndeterminate = progress && progress.progress < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-sm rounded-lg border border-[var(--teal-dim)]/40 bg-[var(--bg-secondary)] p-5 shadow-xl">
        <h3 className="mb-3 text-sm font-semibold text-[var(--accent)]">
          Syncing Addon Catalog
        </h3>
        <p className="mb-3 text-sm text-[var(--text-primary)]">
          {progress?.detail || "Starting..."}
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-primary)]">
          {isIndeterminate ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--teal)]" />
          ) : (
            <div
              className="h-full rounded-full bg-[var(--teal)] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {progress?.stage === "done" ? "Complete!" : "Please wait..."}
        </p>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("installed");
  const [globalError, setGlobalError] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [updates, setUpdates] = useState<AddonUpdate[]>([]);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doSync = useCallback(
    async (showModal: boolean) => {
      if (syncing) return;
      setSyncing(true);
      if (showModal) {
        setShowSyncModal(true);
        setSyncProgress(null);
      }
      try {
        await invoke<number>("sync_catalog");
      } catch (err) {
        setGlobalError(`Catalog sync failed: ${err}`);
      } finally {
        setSyncing(false);
        if (showModal) {
          // Brief delay so user sees "Complete!"
          setTimeout(() => setShowSyncModal(false), 600);
        }
      }
    },
    [syncing]
  );

  // Listen for sync progress and update events
  useEffect(() => {
    const unlistenProgress = listen<SyncProgress>("catalog-sync-progress", (event) => {
      setSyncProgress(event.payload);
    });
    const unlistenUpdates = listen<AddonUpdate[]>("updates-available", (event) => {
      setUpdates(event.payload);
    });
    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenUpdates.then((fn) => fn());
    };
  }, []);

  // Startup: check catalog status, sync if needed
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await invoke<CatalogStatus>("get_catalog_status");
        if (cancelled) return;
        if (status.addon_count === 0) {
          // First run — sync with modal
          doSync(true);
        } else {
          // Background sync if stale
          doSync(false);
        }
      } catch (err) {
        if (!cancelled) {
          setGlobalError(`Failed to check catalog status: ${err}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic sync
  useEffect(() => {
    const setupTimer = async () => {
      const hours = await invoke<number>("get_sync_interval").catch(() => 2);
      const ms = hours * 60 * 60 * 1000;
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      syncTimerRef.current = setInterval(() => {
        doSync(false);
      }, ms);
    };
    setupTimer();
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [doSync]);

  return (
    <div className="flex h-screen flex-col">
      {globalError && (
        <ErrorOverlay
          message={globalError}
          onClose={() => setGlobalError("")}
        />
      )}
      {showSyncModal && <SyncModal progress={syncProgress} />}
      <header className="flex items-center gap-4 border-b border-[var(--teal-dim)]/30 bg-[var(--bg-secondary)] px-6 py-3">
        <h1 className="text-xl font-bold tracking-wide text-[var(--accent)] drop-shadow-[0_0_8px_var(--teal)]">
          Grimoire
        </h1>
        <nav className="flex gap-1">
          {(["installed", "browse", "settings"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded px-4 py-1.5 text-sm font-medium capitalize transition ${
                activeTab === tab
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-secondary)] hover:bg-white/5 hover:text-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
        {syncing && !showSyncModal && (
          <span className="ml-auto text-xs text-[var(--teal)] animate-pulse">
            Syncing catalog...
          </span>
        )}
      </header>

      <main className="flex-1 overflow-auto p-6">
        {activeTab === "installed" && (
          <InstalledPage
            onError={setGlobalError}
            updates={updates}
            onCheckUpdates={() => doSync(true)}
            checking={syncing}
          />
        )}
        {activeTab === "browse" && (
          <BrowsePage
            onError={setGlobalError}
            onSync={() => doSync(true)}
            syncing={syncing}
          />
        )}
        {activeTab === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

function InstalledPage({
  onError,
  updates,
  onCheckUpdates,
  checking,
}: {
  onError: (msg: string) => void;
  updates: AddonUpdate[];
  onCheckUpdates: () => void;
  checking: boolean;
}) {
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [showLibraries, setShowLibraries] = useState(false);

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

  useEffect(() => {
    loadAddons();
  }, []);

  const updateMap = new Map(updates.map((u) => [u.dir_name, u]));

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
            onClick={loadAddons}
            className="rounded border border-[var(--teal-dim)]/30 px-3 py-1.5 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 hover:text-white"
          >
            Refresh
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
            <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3">
              <h3 className="mb-2 text-sm font-semibold text-[var(--accent)]">
                Updates Available ({updates.length})
              </h3>
              <div className="space-y-1">
                {updates.map((u) => (
                  <div
                    key={u.dir_name}
                    className="flex items-center justify-between text-xs"
                  >
                    <span>{u.title}</span>
                    <span className="text-[var(--text-secondary)]">
                      {u.installed_version} →{" "}
                      <span className="text-[var(--teal)]">{u.latest_version}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
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
                  onUninstall={handleUninstall}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AddonCard({
  addon,
  update,
  onUninstall,
}: {
  addon: InstalledAddon;
  update?: AddonUpdate;
  onUninstall: (dirName: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
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
        update
          ? "border-[var(--accent)]/30 bg-[var(--bg-card)]"
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
            {update && (
              <span className="rounded bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                UPDATE
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            {addon.author && <span>by {addon.author}</span>}
            {addon.version && <span>v{addon.version}</span>}
            {update && (
              <span className="text-[var(--teal)]">→ v{update.latest_version}</span>
            )}
          </div>
        </div>
        <button
          onClick={handleUninstall}
          disabled={uninstalling}
          className="ml-3 shrink-0 rounded border border-red-500/30 px-3 py-1 text-xs font-medium text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
        >
          {uninstalling ? "Removing..." : "Uninstall"}
        </button>
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

function BrowsePage({
  onError,
  onSync,
  syncing,
}: {
  onError: (msg: string) => void;
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
  const PAGE_SIZE = 50;

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
      await invoke<string[]>("install_addon", { uid });
      // Refresh installed dirs so the badge updates
      loadInstalledDirs();
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

function CatalogCard({
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

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

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

function SettingsPage() {
  const [addonPath, setAddonPath] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [syncInterval, setSyncInterval] = useState<number>(2);
  const [syncStatus, setSyncStatus] = useState<string>("");

  useEffect(() => {
    invoke<string | null>("get_addon_path")
      .then((path) => {
        if (path) {
          setAddonPath(path);
          setStatus("Path detected");
        } else {
          setStatus("No ESO addon folder found — please select manually");
        }
      })
      .catch(() => setStatus("Failed to detect addon path"));

    invoke<number>("get_sync_interval")
      .then((hours) => setSyncInterval(hours))
      .catch(() => {});
  }, []);

  const handleBrowse = async () => {
    const selected = await open({
      directory: true,
      title: "Select ESO AddOns folder",
    });
    if (selected) {
      try {
        await invoke("set_addon_path", { path: selected });
        setAddonPath(selected);
        setStatus("Path saved");
      } catch (err) {
        setStatus(`Error: ${err}`);
      }
    }
  };

  const handleSyncIntervalChange = async (value: string) => {
    const hours = parseFloat(value);
    if (isNaN(hours) || hours < 0.1) return;
    setSyncInterval(hours);
    try {
      await invoke("set_sync_interval", { hours });
      setSyncStatus("Saved");
      setTimeout(() => setSyncStatus(""), 2000);
    } catch (err) {
      setSyncStatus(`Error: ${err}`);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Settings</h2>

      <div className="rounded-lg bg-[var(--bg-card)] p-4">
        <label className="block text-sm font-medium text-[var(--text-secondary)]">
          ESO Addons Path
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={addonPath}
            placeholder="No path detected..."
            className="flex-1 rounded border border-[var(--teal-dim)]/30 bg-[var(--bg-secondary)] px-3 py-2 text-sm text-white placeholder:text-[var(--text-secondary)]"
            readOnly
          />
          <button
            onClick={handleBrowse}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-110"
          >
            Browse
          </button>
        </div>
        {status && (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">{status}</p>
        )}
      </div>

      <div className="rounded-lg bg-[var(--bg-card)] p-4">
        <label className="block text-sm font-medium text-[var(--text-secondary)]">
          Catalog Sync Interval
        </label>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="number"
            min="0.1"
            step="0.5"
            value={syncInterval}
            onChange={(e) => handleSyncIntervalChange(e.target.value)}
            className="w-24 rounded border border-[var(--teal-dim)]/30 bg-[var(--bg-secondary)] px-3 py-2 text-sm text-white"
          />
          <span className="text-sm text-[var(--text-secondary)]">hours</span>
          {syncStatus && (
            <span className="text-xs text-[var(--teal)]">{syncStatus}</span>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          How often the addon catalog and update information is automatically refreshed from ESOUI.
        </p>
      </div>
    </div>
  );
}

export default App;
