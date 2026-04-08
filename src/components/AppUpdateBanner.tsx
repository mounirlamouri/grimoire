import { useState, useEffect, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Status =
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; percent: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export function AppUpdateBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdate = useCallback(async () => {
    try {
      setStatus({ kind: "checking" });
      const update = await check();
      if (update) {
        setStatus({ kind: "available", update });
      } else {
        setStatus(null);
      }
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    let cancelled = false;
    (async () => {
      await checkForUpdate();
      if (cancelled) setStatus(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [checkForUpdate]);

  const handleInstall = async () => {
    if (status?.kind !== "available") return;
    const { update } = status;
    try {
      setStatus({ kind: "downloading", percent: 0 });
      let totalLength = 0;
      let downloaded = 0;
      let lastPercent = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalLength = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalLength > 0) {
            const percent = Math.round((downloaded / totalLength) * 100);
            if (percent !== lastPercent) {
              lastPercent = percent;
              setStatus({ kind: "downloading", percent });
            }
          }
        }
      });
      setStatus({ kind: "ready" });
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  };

  const handleRestart = async () => {
    try {
      await relaunch();
    } catch (err) {
      setStatus({ kind: "error", message: String(err) });
    }
  };

  const handleRetry = () => {
    setDismissed(false);
    checkForUpdate();
  };

  if (!status || dismissed) return null;
  if (status.kind === "checking") return null;

  const showDismiss = status.kind !== "downloading";

  return (
    <div className="flex items-center gap-3 border-b border-[var(--teal-dim)]/30 bg-[var(--teal)]/10 px-6 py-2 text-sm">
      {status.kind === "available" && (
        <>
          <span className="text-[var(--teal)]">
            A new version ({status.update.version}) is available.
          </span>
          <button
            onClick={handleInstall}
            className="rounded bg-[var(--teal)] px-3 py-1 text-xs font-medium text-white transition hover:brightness-110"
          >
            Download &amp; Install
          </button>
        </>
      )}

      {status.kind === "downloading" && (
        <>
          <span className="text-[var(--teal)]">
            Downloading update... {status.percent}%
          </span>
          <div className="h-1.5 flex-1 rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[var(--teal)] transition-all"
              style={{ width: `${status.percent}%` }}
            />
          </div>
        </>
      )}

      {status.kind === "ready" && (
        <>
          <span className="text-[var(--teal)]">
            Update installed. Restart to apply.
          </span>
          <button
            onClick={handleRestart}
            className="rounded bg-[var(--teal)] px-3 py-1 text-xs font-medium text-white transition hover:brightness-110"
          >
            Restart Now
          </button>
        </>
      )}

      {status.kind === "error" && (
        <>
          <span className="text-red-400">
            Update failed: {status.message}
          </span>
          <button
            onClick={handleRetry}
            className="rounded bg-[var(--teal)] px-3 py-1 text-xs font-medium text-white transition hover:brightness-110"
          >
            Retry
          </button>
        </>
      )}

      {showDismiss && (
        <button
          onClick={() => setDismissed(true)}
          className="ml-auto text-[var(--text-secondary)] hover:text-white"
          aria-label="Dismiss"
        >
          &times;
        </button>
      )}
    </div>
  );
}
