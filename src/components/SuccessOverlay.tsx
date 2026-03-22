import { useState } from "react";

export function SuccessOverlay({
  message,
  details,
  onClose,
}: {
  message: string;
  details: string | null;
  onClose: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 max-w-lg rounded-lg border border-emerald-500/40 bg-[var(--bg-secondary)] p-5 shadow-xl">
        <h3 className="mb-2 text-sm font-semibold text-emerald-400">Success</h3>
        <p className="mb-3 text-sm text-[var(--text-primary)]">{message}</p>
        {details && (
          <>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="mb-3 text-xs text-[var(--text-secondary)] underline transition hover:text-white"
            >
              {showDetails ? "Hide details" : "Show details"}
            </button>
            {showDetails && (
              <pre className="mb-3 max-h-48 overflow-auto rounded border border-white/10 bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)]">
                {details}
              </pre>
            )}
          </>
        )}
        <div>
          <button
            onClick={onClose}
            className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
