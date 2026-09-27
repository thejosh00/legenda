/**
 * The poller: new items from app-fetched follows, no model needed.
 *
 * YouTube channels are checked hourly, papers daily. Unscreened follows put new items
 * straight on the list; screened ones offer them to the curator. Each follow records
 * when it was checked and its last error, and one failing follow never stops the rest.
 */
import {describe} from '../core/errors.ts';
import {selectNew} from '../core/poll.ts';
import {isShort} from '../core/youtube.ts';
import type {Follow, ItemInput, SourceId} from '../core/types.ts';
import {Ctx, type AppDeps} from './context.ts';
import {getFollow, isCreatorBlocked, listFollows} from './follows.ts';
import {offerCandidate} from './intake.ts';
import {insertItem} from './items.ts';
import {boolSetting, getSetting, numberSetting} from './settings.ts';

export const POLL_PERIOD_MS: Partial<Record<SourceId, number>> = {
  youtube: 60 * 60_000,
  papers: 24 * 60 * 60_000,
};

export const POLLER_ACTOR = 'app';

export interface PollResult {
  follow_id: string;
  title: string;
  added: number;
  offered: number;
  skipped: number;
  error: string | null;
}

/** Fill in what a feed leaves out (YouTube durations) when a key allows it. */
async function enrich(ctx: Ctx, follow: Follow, items: ItemInput[]): Promise<ItemInput[]> {
  if (follow.source !== 'youtube' || items.length === 0 || getSetting(ctx.db, 'youtube_api_key') === undefined) return items;
  const source = ctx.sources.get('youtube');
  try {
    const detailed = new Map((await source.details!(items.map(i => i.external_id))).map(d => [d.external_id, d]));
    return items.map(item => {
      const found = detailed.get(item.external_id);
      return found === undefined ? item : {...item, length_minutes: found.length_minutes ?? null, extra: {...item.extra, ...found.extra}};
    });
  } catch {
    // Out of quota or offline: take them without durations rather than not at all.
    return items;
  }
}

export async function pollFollow(ctx: Ctx, follow: Follow): Promise<PollResult> {
  const result: PollResult = {follow_id: follow.id, title: follow.title, added: 0, offered: 0, skipped: 0, error: null};
  const source = ctx.sources.get(follow.source);
  if (source.poll === undefined || follow.status !== 'following') return result;

  try {
    const entries = await source.poll(follow, follow.cursor);
    const backfill = numberSetting(ctx.db, `${follow.source}_backfill`);
    const selection = selectNew(entries, follow.cursor, backfill);
    let take = await enrich(ctx, follow, selection.take);

    const before = take.length;
    if (follow.source === 'youtube' && boolSetting(ctx.db, 'skip_shorts')) take = take.filter(item => !isShort(item));
    take = take.filter(item => !isCreatorBlocked(ctx, item.source, item.creator_external_id));
    result.skipped = before - take.length;

    ctx.write(() => {
      // Re-read: the user may have unfollowed or toggled screening while we fetched.
      const current = getFollow(ctx, follow.id);
      if (current === undefined || current.status !== 'following') return;
      for (const item of take) {
        if (current.screened) {
          if (offerCandidate(ctx, current, item)) result.offered += 1;
        } else if (!insertItem(ctx, item, {origin: 'follow', follow_id: current.id}).existing) {
          result.added += 1;
        }
      }
      ctx.db.query('UPDATE follows SET cursor = ?, last_checked = ?, last_error = NULL WHERE id = ?').run(selection.cursor, ctx.now(), current.id);
    });
  } catch (error) {
    result.error = describe(error);
    ctx.db.query('UPDATE follows SET last_checked = ?, last_error = ? WHERE id = ?').run(ctx.now(), result.error, follow.id);
  }
  if (result.added + result.offered > 0 || result.error !== null) {
    ctx.event('follow', follow.id, {kind: 'polled', title: follow.title, added: result.added, offered: result.offered, error: result.error});
  }
  return result;
}

/** Poll every app-fetched follow, or only those due by their source's period. */
export async function pollAll(deps: AppDeps, options: {onlyDue: boolean}): Promise<PollResult[]> {
  const ctx = new Ctx(deps, POLLER_ACTOR);
  const nowMs = new Date(ctx.now()).getTime();
  const results: PollResult[] = [];
  for (const follow of listFollows(ctx, {status: 'following'})) {
    if (follow.fetched_by !== 'app') continue;
    const period = POLL_PERIOD_MS[follow.source];
    if (period === undefined) continue;
    if (options.onlyDue && follow.last_checked !== null && nowMs - new Date(follow.last_checked).getTime() < period) continue;
    results.push(await pollFollow(ctx, follow));
  }
  return results;
}
