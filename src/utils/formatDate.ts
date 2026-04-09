/**
 * Format a millisecond timestamp as a human-readable relative date.
 * Examples: "2 days ago", "3 months ago", "1 year ago"
 */
export function formatRelativeDate(timestampMs: number): string {
  const days = Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60 * 24));

  if (days < 0) return "just now";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) return years === 1 ? "1 year ago" : `${years} years ago`;
  return years === 1
    ? `1 year, ${remainingMonths} mo ago`
    : `${years} years, ${remainingMonths} mo ago`;
}
