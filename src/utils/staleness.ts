export type StalenessLevel = "error" | "warning" | null;

export function getStaleness(
  catalogDateMs: number | undefined | null,
  warningDays: number,
  errorDays: number,
): StalenessLevel {
  if (catalogDateMs == null) return null;
  const ageDays = (Date.now() - catalogDateMs) / (1000 * 60 * 60 * 24);
  if (ageDays >= errorDays) return "error";
  if (ageDays >= warningDays) return "warning";
  return null;
}
