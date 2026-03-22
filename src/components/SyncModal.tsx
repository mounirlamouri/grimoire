import type { SyncProgress } from "../types/addon";

export function SyncModal({ progress }: { progress: SyncProgress | null }) {
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
