import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { InstalledAddon } from "./types/addon";

type Tab = "installed" | "browse" | "settings";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("installed");

  return (
    <div className="flex h-screen flex-col">
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
        {activeTab === "installed" && <InstalledPage />}
        {activeTab === "browse" && <BrowsePage />}
        {activeTab === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

function InstalledPage() {
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [showLibraries, setShowLibraries] = useState(false);

  const loadAddons = () => {
    setLoading(true);
    setError("");
    invoke<InstalledAddon[]>("get_installed_addons")
      .then((result) => {
        setAddons(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  };

  useEffect(() => {
    loadAddons();
  }, []);

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
          {!loading && !error && (
            <span className="text-xs text-[var(--text-secondary)]">
              {addonCount} addons, {libCount} libraries
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
          <button className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110">
            Update All
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--text-secondary)]">Scanning addons...</p>
      ) : error ? (
        <p className="text-[var(--accent)]">{error}</p>
      ) : (
        <>
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
                <AddonCard key={addon.dir_name} addon={addon} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AddonCard({ addon }: { addon: InstalledAddon }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="cursor-pointer rounded-lg border border-[var(--teal-dim)]/20 bg-[var(--bg-card)] p-3 transition hover:border-[var(--teal-dim)]/40"
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
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            {addon.author && <span>by {addon.author}</span>}
            {addon.version && <span>v{addon.version}</span>}
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
