import type { BatchProgress } from "../utils/batchUpdate";

export function UpdateProgressModal({ completed, total, title }: BatchProgress) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const current = Math.min(completed + 1, total);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-sm rounded-lg border border-[var(--teal-dim)]/40 bg-[var(--bg-secondary)] p-5 shadow-xl">
        <h3 className="mb-3 text-sm font-semibold text-[var(--accent)]">
          Updating Addons
        </h3>
        <p className="mb-3 truncate text-sm text-[var(--text-primary)]">
          Updating {title}...
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          className="h-2 overflow-hidden rounded-full bg-[var(--bg-primary)]"
        >
          <div
            className="h-full rounded-full bg-[var(--teal)] transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {current} / {total}
        </p>
      </div>
    </div>
  );
}
