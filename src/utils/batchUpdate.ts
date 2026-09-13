import type { AddonUpdate, InstallResult } from "../types/addon";

export interface BatchProgress {
  /** Number of addons already processed (the one in flight is `completed + 1`). */
  completed: number;
  total: number;
  /** Title of the addon currently being updated. */
  title: string;
}

export interface BatchUpdateOutcome {
  total: number;
  updatedUids: string[];
  failures: string[];
  depWarnings: string[];
  autoInstalledDeps: string[];
}

export type BatchUpdateSummary =
  | { kind: "success"; message: string; details: string | null }
  | { kind: "error"; message: string };

function pluralAddons(n: number): string {
  return `${n} addon${n !== 1 ? "s" : ""}`;
}

/**
 * Updates addons one at a time, reporting progress before each one. Failures
 * don't stop the batch; they are collected into the returned outcome.
 */
export async function runBatchUpdate(
  updates: AddonUpdate[],
  updateOne: (uid: string) => Promise<InstallResult>,
  onProgress: (progress: BatchProgress) => void
): Promise<BatchUpdateOutcome> {
  const outcome: BatchUpdateOutcome = {
    total: updates.length,
    updatedUids: [],
    failures: [],
    depWarnings: [],
    autoInstalledDeps: [],
  };
  const autoDeps = new Set<string>();

  for (let i = 0; i < updates.length; i++) {
    const update = updates[i];
    onProgress({ completed: i, total: updates.length, title: update.title });
    try {
      const result = await updateOne(update.uid);
      outcome.updatedUids.push(update.uid);
      result.auto_installed_deps.forEach((d) => autoDeps.add(d.name));
      const issues: string[] = [];
      if (result.missing_deps.length > 0) {
        issues.push(`not found on ESOUI: ${result.missing_deps.join(", ")}`);
      }
      if (result.failed_deps.length > 0) {
        issues.push(`failed to install: ${result.failed_deps.map((d) => `${d.dir_name} (${d.error})`).join(", ")}`);
      }
      if (issues.length > 0) {
        outcome.depWarnings.push(`${update.title}: ${issues.join("; ")}`);
      }
    } catch (err) {
      outcome.failures.push(`${update.title}: ${err}`);
    }
  }

  outcome.autoInstalledDeps = [...autoDeps];
  return outcome;
}

/** Builds the single message shown once the whole batch has finished. */
export function summarizeBatchUpdate(outcome: BatchUpdateOutcome): BatchUpdateSummary {
  const depsLine =
    outcome.autoInstalledDeps.length > 0
      ? `Automatically installed dependencies: ${outcome.autoInstalledDeps.join(", ")}`
      : null;

  if (outcome.failures.length === 0 && outcome.depWarnings.length === 0) {
    return {
      kind: "success",
      message: `${pluralAddons(outcome.updatedUids.length)} updated successfully.`,
      details: depsLine,
    };
  }

  const summary =
    outcome.failures.length > 0
      ? `${outcome.failures.length} of ${pluralAddons(outcome.total)} failed to update.`
      : `${pluralAddons(outcome.updatedUids.length)} updated, but some may not function properly because dependencies could not be installed.`;
  const sections: string[] = [];
  if (outcome.failures.length > 0) {
    sections.push(`Failed to update:\n${outcome.failures.join("\n")}`);
  }
  if (outcome.depWarnings.length > 0) {
    sections.push(`Updated with dependency problems:\n${outcome.depWarnings.join("\n")}`);
  }
  if (depsLine) {
    sections.push(depsLine);
  }
  return { kind: "error", message: `${summary}\n\n${sections.join("\n\n")}` };
}
