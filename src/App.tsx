import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AddonUpdate, CatalogStatus, UrlInstallResult, SyncProgress } from "./types/addon";
import { ErrorOverlay } from "./components/ErrorOverlay";
import { SuccessOverlay } from "./components/SuccessOverlay";
import { SyncModal } from "./components/SyncModal";
import { BootstrapModal } from "./components/BootstrapModal";
import { InstalledPage } from "./pages/InstalledPage";
import { BrowsePage } from "./pages/BrowsePage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppUpdateBanner } from "./components/AppUpdateBanner";

type Tab = "installed" | "browse" | "settings";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("installed");
  const [globalError, setGlobalError] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<{ message: string; details: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [updates, setUpdates] = useState<AddonUpdate[]>([]);
  const [bootstrapProgress, setBootstrapProgress] = useState<{ current: number; total: number } | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installedKey, setInstalledKey] = useState(0);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

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
        if (showModal) {
          setGlobalError(`Catalog sync failed: ${err}`);
        } else {
          console.warn("Background catalog sync failed:", err);
        }
      } finally {
        setSyncing(false);
        if (showModal) {
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
    const unlistenBootstrap = listen<{ current: number; total: number }>("bootstrap-progress", (event) => {
      const { current, total } = event.payload;
      if (current >= total) {
        // Done — hide modal after a brief moment
        setTimeout(() => setBootstrapProgress(null), 400);
      } else {
        setBootstrapProgress({ current, total });
      }
    });
    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenUpdates.then((fn) => fn());
      unlistenBootstrap.then((fn) => fn());
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
          doSync(true);
        } else {
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

  const handleUrlInstall = async () => {
    const trimmed = urlValue.trim();
    if (!trimmed) return;
    setInstalling(true);
    try {
      const result = await invoke<UrlInstallResult>("install_addon_by_url", { url: trimmed });
      setShowUrlInput(false);
      setUrlValue("");

      if (result.already_installed) {
        setSuccessMsg({ message: `${result.addon_name} is already installed.`, details: null });
        return;
      }

      setInstalledKey((k) => k + 1);
      const missingDeps = result.missing_deps ?? [];
      const failedDeps = result.failed_deps ?? [];
      const autoDeps = result.auto_installed_deps ?? [];
      const errors: string[] = [];
      if (missingDeps.length > 0) {
        errors.push(`Some required dependencies could not be found on ESOUI: ${missingDeps.join(", ")}`);
      }
      if (failedDeps.length > 0) {
        errors.push(`Failed to install some dependencies: ${failedDeps.map((d) => `${d.dir_name} (${d.error})`).join(", ")}`);
      }
      if (errors.length > 0) {
        if (autoDeps.length > 0) {
          errors.push(`Automatically installed dependencies: ${autoDeps.map((d) => d.name).join(", ")}`);
        }
        setGlobalError(`${result.addon_name} was installed successfully, but it may not function properly because some dependencies could not be installed.\n\n${errors.join("\n\n")}`);
      } else {
        setSuccessMsg({
          message: `${result.addon_name} was installed successfully.`,
          details: autoDeps.length > 0 ? `Automatically installed dependencies: ${autoDeps.map((d) => d.name).join(", ")}` : null,
        });
      }
    } catch (err) {
      setGlobalError(`Failed to install addon from URL.\n\n${err}`);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex h-screen flex-col">
      {globalError && (
        <ErrorOverlay
          message={globalError}
          onClose={() => setGlobalError("")}
        />
      )}
      {successMsg && (
        <SuccessOverlay
          message={successMsg.message}
          details={successMsg.details}
          onClose={() => setSuccessMsg(null)}
        />
      )}
      {showSyncModal && <SyncModal progress={syncProgress} />}
      {bootstrapProgress && (
        <BootstrapModal current={bootstrapProgress.current} total={bootstrapProgress.total} />
      )}
      <AppUpdateBanner />
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
        <div className="ml-auto flex items-center gap-2">
          {showUrlInput && (
            <form
              onSubmit={(e) => { e.preventDefault(); handleUrlInstall(); }}
              className="flex items-center gap-1"
            >
              <input
                ref={urlInputRef}
                type="text"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="Paste ESOUI URL…"
                className="w-64 rounded bg-[var(--bg-primary)] px-3 py-1 text-sm text-white placeholder-white/40 border border-[var(--teal-dim)]/40 focus:border-[var(--teal)] focus:outline-none"
                disabled={installing}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Escape") { setShowUrlInput(false); setUrlValue(""); } }}
              />
              <button
                type="submit"
                disabled={installing || !urlValue.trim()}
                className="rounded bg-[var(--accent)] px-3 py-1 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {installing ? "Installing…" : "Install"}
              </button>
            </form>
          )}
          <button
            onClick={() => { setShowUrlInput((v) => !v); setTimeout(() => urlInputRef.current?.focus(), 50); }}
            className={`flex h-8 w-8 items-center justify-center rounded border transition ${
              showUrlInput
                ? "border-[var(--accent)] bg-[var(--accent)]/20 text-white"
                : "border-[var(--teal-dim)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/15 hover:text-white hover:border-[var(--accent)]/60"
            }`}
            title="Install from ESOUI URL"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`h-5 w-5 transition-transform ${showUrlInput ? "rotate-45" : ""}`}>
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
          </button>
          {syncing && !showSyncModal && (
            <span className="text-xs text-[var(--teal)] animate-pulse">
              Syncing catalog...
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {activeTab === "installed" && (
          <InstalledPage
            key={installedKey}
            onError={setGlobalError}
            onSuccess={setSuccessMsg}
            updates={updates}
            onCheckUpdates={() => doSync(true)}
            checking={syncing}
            onUpdateDone={(uid) =>
              setUpdates((prev) => prev.filter((u) => u.uid !== uid))
            }
          />
        )}
        {activeTab === "browse" && (
          <BrowsePage
            onError={setGlobalError}
            onSuccess={setSuccessMsg}
            onSync={() => doSync(true)}
            syncing={syncing}
          />
        )}
        {activeTab === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

export default App;
