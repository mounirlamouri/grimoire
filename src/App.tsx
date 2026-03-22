import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AddonUpdate, CatalogStatus, SyncProgress } from "./types/addon";
import { ErrorOverlay } from "./components/ErrorOverlay";
import { SuccessOverlay } from "./components/SuccessOverlay";
import { SyncModal } from "./components/SyncModal";
import { InstalledPage } from "./pages/InstalledPage";
import { BrowsePage } from "./pages/BrowsePage";
import { SettingsPage } from "./pages/SettingsPage";

type Tab = "installed" | "browse" | "settings";

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("installed");
  const [globalError, setGlobalError] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<{ message: string; details: string | null } | null>(null);
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
