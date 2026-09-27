/**
 * Marking things done or dismissed, and the reactions that come with it.
 *
 * The user's reactions are the product: they are what the curator learns from. So each
 * one is a structured row with a kind, and agents can never write one.
 */
import {AppError, EXIT_USAGE, refused} from '../core/errors.ts';
import {FEEDBACK_KINDS, isFeedbackKind, kindAppliesTo, kindsFor, type FeedbackKind} from '../core/feedback.ts';
import type {Item, ItemState} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {blockCreatorOf} from './follows.ts';
import {getItem} from './items.ts';

export interface FeedbackRow {
  id: string;
  item_id: string | null;
  follow_id: string | null;
  kind: FeedbackKind;
  note: string;
  actor: string;
  at: string;
}

function checkKind(kind: string, item: Item, moment: 'done' | 'dismiss' | 'any'): FeedbackKind {
  if (!isFeedbackKind(kind)) throw new AppError(`unknown feedback kind "${kind}"`, EXIT_USAGE);
  const spec = FEEDBACK_KINDS[kind];
  if (moment !== 'any' && spec.moment !== moment && spec.moment !== 'any') {
    throw new AppError(`"${kind}" is not a ${moment === 'done' ? 'reaction' : 'dismiss reason'}; use one of ${kindsFor(moment, item.source).join(', ')}`, EXIT_USAGE);
  }
  if (!kindAppliesTo(kind, item.source)) {
    throw new AppError(`"${kind}" does not apply to ${item.source} items; use one of ${kindsFor(moment === 'any' ? spec.moment : moment, item.source).join(', ')}`, EXIT_USAGE);
  }
  return kind;
}

export function recordFeedback(ctx: Ctx, target: {item_id?: string | null; follow_id?: string | null}, kind: FeedbackKind, note = ''): FeedbackRow {
  if (ctx.isAgent) throw refused('Giving feedback');
  const row: FeedbackRow = {id: ctx.newId(), item_id: target.item_id ?? null, follow_id: target.follow_id ?? null, kind, note: note.trim(), actor: ctx.actor, at: ctx.now()};
  ctx.db
    .query('INSERT INTO feedback (id, item_id, follow_id, kind, note, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.item_id, row.follow_id, row.kind, row.note, row.actor, row.at);
  ctx.event('feedback', row.id, {kind, item_id: row.item_id, follow_id: row.follow_id, note: row.note});
  return row;
}

function setState(ctx: Ctx, item: Item, state: ItemState): Item {
  if (item.state === state) return item;
  ctx.db.query('UPDATE items SET state = ?, changed = ?, version = version + 1 WHERE id = ?').run(state, ctx.now(), item.id);
  const updated = getItem(ctx, item.id)!;
  ctx.event('item', item.id, {kind: 'state', title: item.title, from: item.state, to: state});
  return updated;
}

export interface Outcome {
  item: Item;
  feedback: FeedbackRow[];
  blocked?: string;
}

export function markDone(ctx: Ctx, item: Item, options: {reaction?: string; note?: string}): Outcome {
  const kind = options.reaction === undefined ? undefined : checkKind(options.reaction, item, 'done');
  const note = options.note?.trim() ?? '';
  const updated = setState(ctx, item, 'done');
  const feedback: FeedbackRow[] = [];
  if (kind !== undefined) feedback.push(recordFeedback(ctx, {item_id: item.id}, kind, note));
  else if (note !== '') feedback.push(recordFeedback(ctx, {item_id: item.id}, 'comment', note));
  return {item: updated, feedback};
}

export function dismiss(ctx: Ctx, item: Item, options: {reason?: string; note?: string; block?: boolean}): Outcome {
  const kind = options.reason === undefined ? undefined : checkKind(options.reason, item, 'dismiss');
  const note = options.note?.trim() ?? '';
  // Block first: if the creator is unknown the whole dismissal is refused, not half done.
  const blocked = options.block === true ? blockCreatorOf(ctx, item) : undefined;
  const updated = setState(ctx, item, 'dismissed');
  const feedback: FeedbackRow[] = [];
  if (kind !== undefined) feedback.push(recordFeedback(ctx, {item_id: item.id}, kind, note));
  else if (note !== '') feedback.push(recordFeedback(ctx, {item_id: item.id}, 'comment', note));
  return {item: updated, feedback, ...(blocked === undefined ? {} : {blocked: blocked.id})};
}

export function restore(ctx: Ctx, item: Item): Item {
  return setState(ctx, item, 'queue');
}

const ANYTIME: Record<string, FeedbackKind> = {more: 'more_like_this', less: 'less_like_this', comment: 'comment'};

export function itemFeedback(ctx: Ctx, item: Item, which: string, note?: string): FeedbackRow {
  const kind = ANYTIME[which] ?? which;
  const checked = checkKind(kind, item, 'any');
  if (FEEDBACK_KINDS[checked].moment !== 'any') {
    throw new AppError(`"${which}" goes with done or dismiss; here use more, less or comment`, EXIT_USAGE);
  }
  if (checked === 'comment' && (note ?? '').trim() === '') throw new AppError('a comment needs --note', EXIT_USAGE);
  return recordFeedback(ctx, {item_id: item.id}, checked, note);
}

export interface FeedbackJoined extends FeedbackRow {
  item: {id: string; title: string; creator: string; source: string; origin: string; reason: string | null; state: string} | null;
}

/** Feedback since a moment, newest first, joined with what it was about. */
export function feedbackSince(ctx: Ctx, since: string, itemId?: string): FeedbackJoined[] {
  const rows = ctx.db
    .query(
      `SELECT f.*, i.title AS i_title, i.creator AS i_creator, i.source AS i_source, i.origin AS i_origin, i.reason AS i_reason, i.state AS i_state
       FROM feedback f LEFT JOIN items i ON i.id = f.item_id
       WHERE f.at >= ? ${itemId === undefined ? '' : 'AND f.item_id = ?'}
       ORDER BY f.at DESC, f.id DESC`,
    )
    .all(...(itemId === undefined ? [since] : [since, itemId])) as Array<FeedbackRow & Record<string, string | null>>;
  return rows.map(row => ({
    id: row.id,
    item_id: row.item_id,
    follow_id: row.follow_id,
    kind: row.kind,
    note: row.note,
    actor: row.actor,
    at: row.at,
    item:
      row.item_id === null || row['i_title'] === null
        ? null
        : {id: row.item_id, title: row['i_title']!, creator: row['i_creator']!, source: row['i_source']!, origin: row['i_origin']!, reason: row['i_reason'] ?? null, state: row['i_state']!},
  }));
}

export function feedbackForItems(ctx: Ctx, ids: string[]): Array<{item_id: string; kind: string; note: string; at: string}> {
  if (ids.length === 0) return [];
  return ctx.db
    .query(`SELECT item_id, kind, note, at FROM feedback WHERE item_id IN (${ids.map(() => '?').join(',')}) ORDER BY at`)
    .all(...ids) as Array<{item_id: string; kind: string; note: string; at: string}>;
}
