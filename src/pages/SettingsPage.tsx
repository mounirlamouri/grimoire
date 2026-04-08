import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export function SettingsPage() {
  const [addonPath, setAddonPath] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [syncInterval, setSyncInterval] = useState<number>(2);
  const [syncStatus, setSyncStatus] = useState<string>("");
  const [stalenessWarningDays, setStalenessWarningDays] = useState<number>(180);
  const [stalenessErrorDays, setStalenessErrorDays] = useState<number>(365);
  const [hideStalenessWarnings, setHideStalenessWarnings] = useState<boolean>(false);
  const [stalenessStatus, setStalenessStatus] = useState<string>("");

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

    invoke<number>("get_staleness_warning_days").then(setStalenessWarningDays).catch(() => {});
    invoke<number>("get_staleness_error_days").then(setStalenessErrorDays).catch(() => {});
    invoke<boolean>("get_hide_staleness_warnings").then(setHideStalenessWarnings).catch(() => {});
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

  const handleStalenessWarningChange = async (value: string) => {
    const days = parseInt(value, 10);
    if (isNaN(days) || days < 1) return;
    if (days >= stalenessErrorDays) {
      setStalenessStatus("Warning threshold must be less than error threshold");
      setTimeout(() => setStalenessStatus(""), 3000);
      return;
    }
    setStalenessWarningDays(days);
    try {
      await invoke("set_staleness_warning_days", { days });
      setStalenessStatus("Saved");
      setTimeout(() => setStalenessStatus(""), 2000);
    } catch (err) {
      setStalenessStatus(`Error: ${err}`);
    }
  };

  const handleStalenessErrorChange = async (value: string) => {
    const days = parseInt(value, 10);
    if (isNaN(days) || days < 1) return;
    if (days <= stalenessWarningDays) {
      setStalenessStatus("Error threshold must be greater than warning threshold");
      setTimeout(() => setStalenessStatus(""), 3000);
      return;
    }
    setStalenessErrorDays(days);
    try {
      await invoke("set_staleness_error_days", { days });
      setStalenessStatus("Saved");
      setTimeout(() => setStalenessStatus(""), 2000);
    } catch (err) {
      setStalenessStatus(`Error: ${err}`);
    }
  };

  const handleHideStalenessChange = async (hide: boolean) => {
    setHideStalenessWarnings(hide);
    try {
      await invoke("set_hide_staleness_warnings", { hide });
      setStalenessStatus("Saved");
      setTimeout(() => setStalenessStatus(""), 2000);
    } catch (err) {
      setStalenessStatus(`Error: ${err}`);
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

      <div className="rounded-lg bg-[var(--bg-card)] p-4">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-[var(--text-secondary)]">
            Addon Staleness Warnings
          </label>
          {stalenessStatus && (
            <span className="text-xs text-[var(--teal)]">{stalenessStatus}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Show a warning or error on addon cards when an addon hasn't been updated on ESOUI in a while. Uses the last-updated date from ESOUI, not your local install date.
        </p>

        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={hideStalenessWarnings}
              onChange={(e) => handleHideStalenessChange(e.target.checked)}
              className="accent-[var(--teal)]"
            />
            Hide staleness warnings
          </label>

          <div className={`space-y-3 ${hideStalenessWarnings ? "opacity-40 pointer-events-none" : ""}`}>
            <div className="flex items-center gap-3">
              <span className="w-36 text-sm text-[var(--text-secondary)]">Warning after</span>
              <input
                type="number"
                min="1"
                step="1"
                value={stalenessWarningDays}
                onChange={(e) => handleStalenessWarningChange(e.target.value)}
                className="w-20 rounded border border-yellow-500/30 bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-white"
              />
              <span className="text-sm text-[var(--text-secondary)]">days without an update</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-36 text-sm text-[var(--text-secondary)]">Error after</span>
              <input
                type="number"
                min="1"
                step="1"
                value={stalenessErrorDays}
                onChange={(e) => handleStalenessErrorChange(e.target.value)}
                className="w-20 rounded border border-red-500/30 bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-white"
              />
              <span className="text-sm text-[var(--text-secondary)]">days without an update</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
