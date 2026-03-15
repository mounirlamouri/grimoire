import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Installed Addons</h2>
        <button className="rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110">
          Update All
        </button>
      </div>
      <p className="text-[var(--text-secondary)]">
        No addons folder configured. Go to Settings to set your ESO addon path.
      </p>
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
