/**
 * Timestamps and calendar days.
 *
 * A moment is ISO-8601 in UTC, to the second: `2026-09-12T10:04:00Z`. A *day* — as in
 * "today's suggestion cap" — is the local calendar day, because that is the one the
 * person lives in.
 */

export function toIsoSeconds(at: Date): string {
  if (Number.isNaN(at.getTime())) throw new RangeError('not a date');
  return `${at.toISOString().slice(0, 19)}Z`;
}

export function nowIso(): string {
  return toIsoSeconds(new Date());
}

/** Any date string a feed or API might send, normalised; undefined if unparseable. */
export function normalizeIso(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value.trim() === '') return undefined;
  const at = new Date(value.trim());
  return Number.isNaN(at.getTime()) ? undefined : toIsoSeconds(at);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The local calendar day a moment falls on, as `YYYY-MM-DD`. */
export function localDate(at: Date | string): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The UTC moment local midnight of `at`'s day falls on. */
export function startOfLocalDayIso(at: string): string {
  const date = new Date(at);
  return toIsoSeconds(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** A moment shifted by whole days (24h steps; fine for windows like "the last 90 days"). */
export function addDaysIso(at: string, days: number): string {
  return toIsoSeconds(new Date(new Date(at).getTime() + days * 86_400_000));
}
