/**
 * What the agent found itself, for sources the app cannot fetch (docs): `add-found`
 * stores what it submits after checking it; `enrich` fills in a link the user pasted.
 *
 * Refused (exit 1) for a disabled source, a missing summary or reason, a URL outside
 * `docs_base_url`, a blocked author, or past a cap. Idempotent by page id.
 */
import {AppError, EXIT_ERROR, EXIT_USAGE, usageError} from '../core/errors.ts';
import {isOrigin, type Item, type ItemInput, type SourceId} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {addSuggestion, sourceForAgent} from './curator.ts';
import {isCreatorBlocked, resolveFollowRef} from './follows.ts';
import {bumpRun, checkFollowIntakeCap} from './intake.ts';
import {findKnownItem, getItem, insertItem, type Added} from './items.ts';
import {requireOpenRun} from './runs.ts';
import {numberSetting} from './settings.ts';

function str(value: unknown, key: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw usageError(`"${key}" must be a string`);
  return value.trim() === '' ? null : value.trim();
}

/** The agent's JSON → an item for `source`. */
export function itemFromJson(source: SourceId, json: Record<string, unknown>): ItemInput {
  const labels = json['labels'];
  if (labels !== undefined && !(Array.isArray(labels) && labels.every(l => typeof l === 'string'))) throw usageError('"labels" must be a list of strings');
  const minutes = json['length_minutes'];
  if (minutes !== undefined && minutes !== null && typeof minutes !== 'number') throw usageError('"length_minutes" must be a number');
  return {
    source,
    external_id: str(json['external_id'], 'external_id') ?? '',
    url: str(json['url'], 'url') ?? '',
    title: str(json['title'], 'title') ?? '',
    creator: str(json['creator'], 'creator') ?? '',
    creator_external_id: str(json['creator_external_id'], 'creator_external_id'),
    container: str(json['container'], 'container'),
    published: str(json['published'], 'published'),
    length_minutes: typeof minutes === 'number' ? Math.round(minutes) : null,
    summary: str(json['summary'], 'summary'),
    extra: labels === undefined ? {} : {labels},
  };
}

export interface AddFoundInput {
  source: string;
  run: string | undefined;
  origin: string | undefined;
  follow: string | undefined;
  reason: string | undefined;
  item: Record<string, unknown>;
}

export function addFound(ctx: Ctx, input: AddFoundInput): Added {
  const source = sourceForAgent(ctx, input.source);
  if (source.fetchedBy !== 'agent' || source.validateAgentItem === undefined) {
    throw usageError(`the app fetches ${source.label.name} itself: use "legenda suggest ${source.id} <url>"`);
  }
  const run = requireOpenRun(ctx, input.run);
  if (input.origin === undefined || !isOrigin(input.origin) || input.origin === 'you') throw usageError('--origin must be follow or agent');

  const item = itemFromJson(source.id, input.item);
  const problem = source.validateAgentItem(item);
  if (problem !== null) throw new AppError(problem, EXIT_ERROR);
  // The page id the agent gives must be the one its URL names, so a link the user pastes later dedups.
  const fromUrl = source.parseRef(item.url);
  if (fromUrl !== null && fromUrl.externalId !== item.external_id) {
    throw new AppError(`external_id ${item.external_id} does not match the page id in the URL (${fromUrl.externalId})`, EXIT_ERROR);
  }

  const known = findKnownItem(ctx, item);
  if (known !== undefined) return {item: known, existing: true};

  if (input.origin === 'agent') return addSuggestion(ctx, item, input.reason, run.id);

  if (input.follow === undefined) throw usageError('--origin follow needs --follow <follow-id>');
  const follow = resolveFollowRef(ctx, input.follow);
  if (follow.source !== source.id || follow.status !== 'following') throw new AppError(`${follow.title} is not a ${source.label.name} follow you can add to`, EXIT_USAGE);
  if (isCreatorBlocked(ctx, item.source, item.creator_external_id)) throw new AppError(`${item.creator} is blocked`, EXIT_ERROR, {creator_blocked: true});
  checkFollowIntakeCap(ctx);
  const added = insertItem(ctx, item, {origin: 'follow', follow_id: follow.id, reason: input.reason ?? null, run_id: run.id});
  if (!added.existing) bumpRun(ctx, run.id, 'from_follows');
  return added;
}

const ENRICHABLE = ['title', 'creator', 'creator_external_id', 'container', 'published', 'length_minutes', 'summary'] as const;

/** Fill a pasted link's empty fields. Nothing already set is overwritten. */
export function enrich(ctx: Ctx, item: Item, json: Record<string, unknown>): {item: Item; filled: string[]} {
  const given = itemFromJson(item.source, {...json, external_id: item.external_id, url: item.url});
  const max = numberSetting(ctx.db, 'summary_max_chars');
  if (given.summary !== null && given.summary !== undefined && given.summary.length > max) {
    throw new AppError(`the summary is ${given.summary.length} characters; keep it to ${max} (summary_max_chars)`, EXIT_ERROR);
  }
  const filled: string[] = [];
  const sets: string[] = [];
  const values: Array<string | number> = [];
  for (const key of ENRICHABLE) {
    const current = item[key];
    const next = given[key];
    const empty = current === null || current === '';
    if (empty && next !== null && next !== undefined && next !== '') {
      sets.push(`${key} = ?`);
      values.push(next);
      filled.push(key);
    }
  }
  const labels = given.extra?.['labels'];
  if (Array.isArray(labels) && item.extra['labels'] === undefined) {
    sets.push('extra = ?');
    values.push(JSON.stringify({...item.extra, labels}));
    filled.push('labels');
  }
  if (filled.length === 0) return {item, filled};
  ctx.db.query(`UPDATE items SET ${sets.join(', ')}, changed = ?, version = version + 1 WHERE id = ?`).run(...values, ctx.now(), item.id);
  ctx.event('item', item.id, {kind: 'enriched', title: given.title || item.title, fields: filled});
  return {item: getItem(ctx, item.id)!, filled};
}
