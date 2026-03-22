import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export function SettingsPage() {
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
