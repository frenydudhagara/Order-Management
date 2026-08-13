/** Display formatting helpers. */

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

/** Render integer cents as money. Cents never become floats before this point. */
export function formatMoney(cents: number): string {
  return currency.format(cents / 100);
}

const timeOfDay = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

export function formatTime(isoTimestamp: string): string {
  return timeOfDay.format(new Date(isoTimestamp));
}

const dateAndTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDateTime(isoTimestamp: string): string {
  return dateAndTime.format(new Date(isoTimestamp));
}

/**
 * "just now" / "4 min ago" / "2 h ago".
 *
 * The API sends UTC with an explicit offset, so `Date` parses the correct
 * instant regardless of where the browser is.
 */
export function formatRelativeTime(isoTimestamp: string, now: Date = new Date()): string {
  const elapsedMs = now.getTime() - new Date(isoTimestamp).getTime();
  const seconds = Math.round(elapsedMs / 1000);

  if (seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Turn "Out for Delivery" into "out-for-delivery" for test ids and classes. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
