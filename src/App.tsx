import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { InstalledAddon, AddonUpdate } from "./types/addon";

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

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("installed");
  const [globalError, setGlobalError] = useState<string>("");

  return (
    <div className="flex h-screen flex-col">
      {globalError && (
        <ErrorOverlay
          message={globalError}
          onClose={() => setGlobalError("")}
        />
      )}
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
      </header>

      <main className="flex-1 overflow-auto p-6">
        {activeTab === "installed" && <InstalledPage onError={setGlobalError} />}
        {activeTab === "browse" && <BrowsePage />}
        {activeTab === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

function InstalledPage({ onError }: { onError: (msg: string) => void }) {
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [updates, setUpdates] = useState<AddonUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
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

  const checkUpdates = () => {
    setChecking(true);
    invoke<AddonUpdate[]>("check_for_updates")
      .then((result) => {
        setUpdates(result);
        setChecking(false);
      })
      .catch((err) => {
        onError(`Update check failed: ${err}`);
        setChecking(false);
      });
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
            onClick={checkUpdates}
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
                      {u.installed_version} → <span className="text-[var(--teal)]">{u.latest_version}</span>
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
}: {
  addon: InstalledAddon;
  update?: AddonUpdate;
}) {
  const [expanded, setExpanded] = useState(false);

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
    </div>
  );
}

function BrowsePage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Browse Addons</h2>
      <p className="text-[var(--text-secondary)]">
        Addon catalog will appear here once synced.
      </p>
    </div>
  );
}

function SettingsPage() {
  const [addonPath, setAddonPath] = useState<string>("");
  const [status, setStatus] = useState<string>("");

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
    </div>
  );
}

export default App;
