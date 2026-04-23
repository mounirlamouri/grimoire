export type ApiCompatibilityStatus = "compatible" | "outdated" | "unknown";

/**
 * Compares an addon's declared APIVersions against the live game APIVersion.
 * `unknown` when we lack either side.
 * `outdated` when every declared APIVersion is below live.
 * `compatible` otherwise.
 */
export function getApiCompatibility(
  addonApiVersions: number[] | null | undefined,
  currentApiVersion: number | null | undefined,
): ApiCompatibilityStatus {
  if (currentApiVersion == null) return "unknown";
  if (!addonApiVersions || addonApiVersions.length === 0) return "unknown";
  const max = Math.max(...addonApiVersions);
  return max < currentApiVersion ? "outdated" : "compatible";
}

/** Formats an APIVersion integer like 101049 as "U49". */
export function formatUpdateLabel(apiVersion: number): string {
  return `U${apiVersion % 1000}`;
}
