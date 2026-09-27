/**
 * Items: everything that has ever been on the list, in any state.
 *
 * Dedup is absolute. `(source, external_id)` is unique, and adding something already
 * known returns the existing item with `existing: true` and changes nothing — so a done
 * or dismissed item is never resurrected by the poller or the agent.
 */
import {AppError, EXIT_USAGE, notFound, usageError} from '../core/errors.ts';
import {resolveIdPrefix} from '../core/id.ts';
import {isItemState, isOrigin, isSourceId, type Item, type ItemInput, type ItemState, type Origin, type SourceId} from '../core/types.ts';
import type {Ctx} from './context.ts';

interface ItemRow extends Omit<Item, 'extra'> {
  extra: string;
}

export function itemFromRow(row: ItemRow): Item {
  let extra: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.extra);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) extra = parsed as Record<string, unknown>;
  } catch {
    // Unreadable extra is dropped rather than failing the whole list.
  }
  return {...row, extra};
}

export function getItem(ctx: Ctx, id: string): Item | undefined {
  const row = ctx.db.query('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | null;
  return row === null ? undefined : itemFromRow(row);
}

/**
 * The item a source id names, if known — by its external id or any of the other names it
 * is known by (`extra.refs`: a paper's arXiv id and DOI alongside its Semantic Scholar id).
 */
export function findKnown(ctx: Ctx, source: SourceId, externalId: string): Item | undefined {
  const row = ctx.db
    .query(
      `SELECT * FROM items WHERE source = ? AND (external_id = ?
         OR EXISTS (SELECT 1 FROM json_each(items.extra, '$.refs') WHERE json_each.value = ?)) LIMIT 1`,
    )
    .get(source, externalId, externalId) as ItemRow | null;
  return row === null ? undefined : itemFromRow(row);
}

/** Every name an incoming item goes by. */
export function refsOf(input: Pick<ItemInput, 'external_id' | 'extra'>): string[] {
  const refs = input.extra?.['refs'];
  return [input.external_id, ...(Array.isArray(refs) ? refs.filter((r): r is string => typeof r === 'string') : [])];
}

/** The known item an incoming one duplicates, under any of its names. */
export function findKnownItem(ctx: Ctx, input: Pick<ItemInput, 'source' | 'external_id' | 'extra'>): Item | undefined {
  for (const ref of refsOf(input)) {
    const found = findKnown(ctx, input.source, ref);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * An item from what a person or agent typed: an id, an unambiguous id prefix, or the
 * item's URL in any form its source recognises.
 */
export function resolveItem(ctx: Ctx, ref: string): Item {
  const trimmed = ref.trim();
  if (trimmed === '') throw usageError('which item? give its id or URL');

  const direct = getItem(ctx, trimmed);
  if (direct !== undefined) return direct;

  const detected = ctx.sources.detect(trimmed);
  if (detected !== undefined) {
    const known = findKnown(ctx, detected.source.id, detected.externalId);
    if (known !== undefined) return known;
    throw notFound(`no item for ${trimmed}`);
  }

  const ids = (ctx.db.query('SELECT id FROM items').all() as Array<{id: string}>).map(r => r.id);
  const match = resolveIdPrefix(ids, trimmed);
  if (match.kind === 'ok') return getItem(ctx, match.id)!;
  if (match.kind === 'ambiguous') throw new AppError(`"${trimmed}" matches more than one item`, EXIT_USAGE, {candidates: match.candidates});
  throw notFound(`no item "${trimmed}"`);
}

export interface Provenance {
  origin: Origin;
  follow_id?: string | null;
  reason?: string | null;
  run_id?: string | null;
}

export interface Added {
  item: Item;
  existing: boolean;
}

const clean = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Insert an item, or return the one already known. Call inside a write transaction. */
export function insertItem(ctx: Ctx, input: ItemInput, provenance: Provenance): Added {
  if (!isSourceId(input.source)) throw usageError(`unknown source "${String(input.source)}"`);
  const externalId = input.external_id?.trim() ?? '';
  if (externalId === '') throw usageError('an item needs an external_id');
  if ((input.url?.trim() ?? '') === '') throw usageError('an item needs a url');

  const known = findKnownItem(ctx, {...input, external_id: externalId});
  if (known !== undefined) return {item: known, existing: true};

  const now = ctx.now();
  const id = ctx.newId();
  ctx.db
    .query(
      `INSERT INTO items (id, source, external_id, url, title, creator, creator_external_id, container, published,
         length_minutes, thumbnail, abstract, summary, extra, origin, follow_id, added_by, reason, state, added, changed, run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queue', ?, ?, ?)`,
    )
    .run(
      id,
      input.source,
      externalId,
      input.url.trim(),
      input.title?.trim() ?? '',
      input.creator?.trim() ?? '',
      clean(input.creator_external_id),
      clean(input.container),
      clean(input.published),
      input.length_minutes ?? null,
      clean(input.thumbnail),
      clean(input.abstract),
      clean(input.summary),
      JSON.stringify(input.extra ?? {}),
      provenance.origin,
      provenance.follow_id ?? null,
      ctx.actor,
      clean(provenance.reason),
      now,
      now,
      provenance.run_id ?? null,
    );
  const item = getItem(ctx, id)!;
  ctx.event('item', id, {kind: 'added', title: item.title, source: item.source, origin: item.origin, state: 'queue'});
  return {item, existing: false};
}

export interface ItemFilter {
  source?: SourceId;
  state?: ItemState | 'all';
  origin?: Origin;
  sort?: 'newest' | 'oldest';
  limit?: number;
  /** Only items added at or after this moment. */
  since?: string;
}

export function parseItemFilter(params: URLSearchParams): ItemFilter {
  const filter: ItemFilter = {};
  const source = params.get('source');
  if (source !== null && source !== '') {
    if (!isSourceId(source)) throw usageError(`source must be one of youtube, papers, docs`);
    filter.source = source;
  }
  const state = params.get('state');
  if (state !== null && state !== '') {
    if (state !== 'all' && !isItemState(state)) throw usageError('state must be queue, done, dismissed or all');
    filter.state = state;
  }
  const origin = params.get('origin');
  if (origin !== null && origin !== '') {
    if (!isOrigin(origin)) throw usageError('origin must be follow, agent or you');
    filter.origin = origin;
  }
  const sort = params.get('sort');
  if (sort !== null && sort !== '') {
    if (sort !== 'newest' && sort !== 'oldest') throw usageError('sort must be newest or oldest');
    filter.sort = sort;
  }
  const limit = params.get('limit');
  if (limit !== null && limit !== '') {
    if (!/^\d+$/.test(limit)) throw usageError('limit must be a number');
    filter.limit = Number(limit);
  }
  return filter;
}

export function listItems(ctx: Ctx, filter: ItemFilter = {}): Item[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  const enabled = ctx.sources.enabled;
  where.push(`source IN (${enabled.map(() => '?').join(',') || "''"})`);
  params.push(...enabled);
  if (filter.source !== undefined) {
    where.push('source = ?');
    params.push(filter.source);
  }
  const state = filter.state ?? 'queue';
  if (state !== 'all') {
    where.push('state = ?');
    params.push(state);
  }
  if (filter.origin !== undefined) {
    where.push('origin = ?');
    params.push(filter.origin);
  }
  if (filter.since !== undefined) {
    where.push('added >= ?');
    params.push(filter.since);
  }
  // Done and dismissed lists read most naturally by when they changed.
  const column = state === 'queue' ? 'added' : 'changed';
  const direction = filter.sort === 'oldest' ? 'ASC' : 'DESC';
  const limit = filter.limit === undefined ? '' : ` LIMIT ${Math.max(0, Math.floor(filter.limit))}`;
  const rows = ctx.db
    .query(`SELECT * FROM items WHERE ${where.join(' AND ')} ORDER BY ${column} ${direction}, id ${direction}${limit}`)
    .all(...params) as ItemRow[];
  return rows.map(itemFromRow);
}

/** Add what a person pasted: a URL (or, with a source given, a bare id). */
export async function addByRef(ctx: Ctx, ref: string, sourceId?: SourceId): Promise<Added> {
  let source;
  let externalId: string;
  if (sourceId !== undefined) {
    source = ctx.sources.get(sourceId);
    const parsed = source.parseRef(ref);
    if (parsed === null) throw usageError(`not a ${source.label.name} link or id: ${ref}`);
    externalId = parsed.externalId;
  } else {
    const detected = ctx.sources.detect(ref);
    if (detected === undefined) {
      const names = ctx.sources.list().map(s => s.label.name).join(', ');
      throw usageError(`not a link legenda recognises: ${ref} (enabled: ${names || 'none'})`);
    }
    source = detected.source;
    externalId = detected.externalId;
  }

  const known = findKnown(ctx, source.id, externalId);
  if (known !== undefined) return {item: known, existing: true};

  let input: ItemInput = {
    source: source.id,
    external_id: externalId,
    url: source.canonicalUrl?.(externalId) ?? ref.trim(),
    title: '',
    creator: '',
  };
  if (source.details !== undefined) {
    try {
      const [found] = await source.details([externalId]);
      if (found !== undefined) input = {...found, source: source.id};
    } catch {
      // Keep the bare item; details can be filled in later.
    }
  }
  // Details may resolve to a different canonical id (a paper's arXiv id → its S2 id).
  return ctx.write(() => insertItem(ctx, input, {origin: 'you'}));
}
