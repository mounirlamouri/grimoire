import type { AddonUpdate } from "../types/addon";

export function UpdatesBanner({
  updates,
  onUpdateAll,
  updatingAll,
}: {
  updates: AddonUpdate[];
  onUpdateAll: () => void;
  updatingAll: boolean;
}) {
  if (updates.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--accent)]">
          Updates Available ({updates.length})
        </h3>
        <button
          onClick={onUpdateAll}
          disabled={updatingAll}
          className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {updatingAll ? "Updating..." : "Update All"}
        </button>
      </div>
      <div className="space-y-1">
        {updates.map((u) => (
          <div
            key={u.dir_name}
            className="flex items-center justify-between text-xs"
          >
            <span>{u.title}</span>
            <span className="text-[var(--text-secondary)]">
              {u.installed_version} →{" "}
              <span className="text-[var(--teal)]">{u.latest_version}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
