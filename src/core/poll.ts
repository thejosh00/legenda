/**
 * Which polled entries are new, pure.
 *
 * A follow's `cursor` is the newest publication time intake has taken. The first poll
 * of a follow has no cursor and takes only the newest `backfill` entries, so following
 * something prolific does not dump its back catalogue on the list. Every later poll
 * takes what was published after the cursor.
 */
import type {ItemInput} from './types.ts';

export interface Selection {
  take: ItemInput[];
  cursor: string | null;
}

export function selectNew(entries: readonly ItemInput[], cursor: string | null, backfill: number): Selection {
  const dated = entries.filter(e => e.published !== null && e.published !== undefined);
  const newestFirst = [...dated].sort((a, b) => (a.published! < b.published! ? 1 : a.published! > b.published! ? -1 : 0));
  const newest = newestFirst[0]?.published ?? null;

  const take = cursor === null ? newestFirst.slice(0, Math.max(0, backfill)) : newestFirst.filter(e => e.published! > cursor);
  const next = newest === null ? cursor : cursor === null || newest > cursor ? newest : cursor;
  // Oldest first, so the list's "newest added" order matches publication order.
  return {take: take.reverse(), cursor: next};
}
