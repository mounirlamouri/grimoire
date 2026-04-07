export function BootstrapModal({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-sm rounded-lg border border-[var(--teal-dim)]/40 bg-[var(--bg-secondary)] p-5 shadow-xl">
        <h3 className="mb-3 text-sm font-semibold text-[var(--accent)]">
          Updating Internal Database
        </h3>
        <p className="mb-3 text-sm text-[var(--text-primary)]">
          Recording addon versions for future update checks...
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-primary)]">
          <div
            className="h-full rounded-full bg-[var(--teal)] transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {current} / {total} addons processed
        </p>
      </div>
    </div>
  );
}
