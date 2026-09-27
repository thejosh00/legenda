/**
 * What the curator can do: look things up through the app's sources, see what is
 * already known, and suggest — within the caps.
 *
 * Every agent write is attributed, capped and idempotent. Suggesting something already
 * known returns it with `existing: true` and counts against nothing, so a crashed and
 * retried run cannot flood the list.
 */
import {AppError, EXIT_ERROR, EXIT_NOT_FOUND, usageError} from '../core/errors.ts';
import {startOfLocalDayIso} from '../core/time.ts';
import type {ItemInput, ItemState, SourceId} from '../core/types.ts';
import type {Source} from '../sources/types.ts';
import type {Ctx} from './context.ts';
import {isCreatorBlocked} from './follows.ts';
import {findKnown, findKnownItem, insertItem, type Added} from './items.ts';
import {bumpRun} from './intake.ts';
import {requireOpenRun} from './runs.ts';
import {getSetting, numberSetting} from './settings.ts';

export interface Annotated extends ItemInput {
  known: ItemState | null;
  known_item_id: string | null;
  creator_blocked: boolean;
}

/** Every result, marked with whether it is already known and whether its creator is blocked. */
export function annotate(ctx: Ctx, items: ItemInput[]): Annotated[] {
  return items.map(item => {
    const known = findKnownItem(ctx, item);
    return {
      source: item.source,
      external_id: item.external_id,
      url: item.url,
      title: item.title,
      creator: item.creator,
      creator_external_id: item.creator_external_id ?? null,
      container: item.container ?? null,
      published: item.published ?? null,
      length_minutes: item.length_minutes ?? null,
      thumbnail: item.thumbnail ?? null,
      abstract: item.abstract ?? null,
      summary: item.summary ?? null,
      extra: item.extra ?? {},
      known: known?.state ?? null,
      known_item_id: known?.id ?? null,
      creator_blocked: isCreatorBlocked(ctx, item.source, item.creator_external_id),
    };
  });
}

/** An enabled source for an agent write; a disabled one is a refused add (exit 1). */
export function sourceForAgent(ctx: Ctx, id: string): Source {
  const found = ctx.sources.enabled.includes(id as SourceId) ? ctx.sources.list().find(s => s.id === id) : undefined;
  if (found === undefined) throw new AppError(`the ${id} source is not enabled on this instance`, EXIT_ERROR);
  return found;
}

export interface CapState {
  cap: number;
  used: number;
  left: number;
}

function suggestedToday(ctx: Ctx, source?: SourceId): number {
  const params: string[] = [startOfLocalDayIso(ctx.now())];
  if (source !== undefined) params.push(source);
  return (ctx.db.query(`SELECT COUNT(*) AS n FROM items WHERE origin = 'agent' AND added >= ? ${source === undefined ? '' : 'AND source = ?'}`).get(...params) as {n: number}).n;
}

export function suggestionCaps(ctx: Ctx): CapState & {per_source: Partial<Record<SourceId, CapState>>} {
  const cap = numberSetting(ctx.db, 'daily_suggestion_cap');
  const used = suggestedToday(ctx);
  const perSource: Partial<Record<SourceId, CapState>> = {};
  for (const id of ctx.sources.enabled) {
    const value = getSetting(ctx.db, `daily_suggestion_cap.${id}`);
    const sourceUsed = suggestedToday(ctx, id);
    const sourceCap = value === undefined ? cap : Math.min(cap, Number(value));
    perSource[id] = {cap: sourceCap, used: sourceUsed, left: Math.max(0, Math.min(sourceCap - sourceUsed, cap - used))};
  }
  return {cap, used, left: Math.max(0, cap - used), per_source: perSource};
}

/** How a creator is counted for the per-run diversity limit. */
const creatorKey = (item: Pick<ItemInput, 'creator' | 'creator_external_id'>) => item.creator_external_id || item.creator.trim().toLowerCase();

function checkSuggestion(ctx: Ctx, item: ItemInput, runId: string): void {
  const caps = suggestionCaps(ctx);
  if (caps.left <= 0) throw new AppError(`today's suggestion cap is reached (${caps.used} of ${caps.cap}, daily_suggestion_cap)`, EXIT_ERROR, {cap: caps.cap, used: caps.used});
  const perSource = caps.per_source[item.source];
  if (perSource !== undefined && perSource.left <= 0) {
    throw new AppError(`today's ${item.source} suggestion cap is reached (${perSource.used} of ${perSource.cap}, daily_suggestion_cap.${item.source})`, EXIT_ERROR, {cap: perSource.cap, used: perSource.used});
  }
  if (isCreatorBlocked(ctx, item.source, item.creator_external_id)) throw new AppError(`${item.creator || 'that creator'} is blocked`, EXIT_ERROR, {creator_blocked: true});

  const limit = numberSetting(ctx.db, 'max_per_creator_per_run');
  const key = creatorKey(item);
  if (key !== '') {
    const rows = ctx.db.query("SELECT creator, creator_external_id FROM items WHERE run_id = ? AND origin = 'agent'").all(runId) as Array<{creator: string; creator_external_id: string | null}>;
    const same = rows.filter(r => creatorKey(r) === key).length;
    if (same >= limit) throw new AppError(`already ${same} from ${item.creator || key} this run (max_per_creator_per_run is ${limit}); spread across creators`, EXIT_ERROR);
  }
}

/** Add an agent's pick. `item` is fully formed (fetched by the app, or supplied by the agent). */
export function addSuggestion(ctx: Ctx, item: ItemInput, reason: string | undefined, runId: string | undefined): Added {
  const run = requireOpenRun(ctx, runId);
  const known = findKnownItem(ctx, item);
  if (known !== undefined) return {item: known, existing: true};
  if (reason === undefined || reason.trim() === '') throw new AppError('a suggestion needs a specific, checkable --reason', EXIT_ERROR);
  checkSuggestion(ctx, item, run.id);
  const added = insertItem(ctx, item, {origin: 'agent', reason, run_id: run.id});
  if (!added.existing) bumpRun(ctx, run.id, 'suggested');
  return added;
}

/** `legenda suggest <source> <ref>`: the app fetches the details itself. */
export async function suggest(ctx: Ctx, input: {source: string; ref: string; reason?: string; run?: string}): Promise<Added> {
  const source = sourceForAgent(ctx, input.source);
  requireOpenRun(ctx, input.run);
  if (source.fetchedBy !== 'app' || source.details === undefined) {
    throw usageError(`${source.label.name} items are supplied by the agent: use "legenda add-found ${source.id}"`);
  }
  const parsed = source.parseRef(input.ref);
  if (parsed === null) throw usageError(`not a ${source.label.name} link or id: ${input.ref}`);
  const known = findKnown(ctx, source.id, parsed.externalId);
  if (known !== undefined) return {item: known, existing: true};
  if (input.reason === undefined || input.reason.trim() === '') throw new AppError('a suggestion needs a specific, checkable --reason', EXIT_ERROR);

  const [found] = await source.details([input.ref]);
  if (found === undefined) throw new AppError(`${source.label.name} has nothing for ${input.ref}`, EXIT_NOT_FOUND);
  return ctx.write(() => addSuggestion(ctx, found, input.reason, input.run));
}
