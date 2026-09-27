/**
 * What the user follows, and blocks, across sources.
 *
 * Following is the user's: an agent can read follows and move an agent-fed follow's
 * cursor, nothing else. A block is a follow row with status `blocked`, so blocking a
 * creator you never followed works the same way as blocking one you did.
 */
import {AppError, EXIT_USAGE, notFound, usageError} from '../core/errors.ts';
import {resolveIdPrefix} from '../core/id.ts';
import type {Follow, FollowCandidate, FollowStatus, Item, SourceId} from '../core/types.ts';
import type {Ctx} from './context.ts';

interface FollowRow extends Omit<Follow, 'screened'> {
  screened: number;
}

export const followFromRow = (row: FollowRow): Follow => ({...row, screened: row.screened === 1});

export function getFollow(ctx: Ctx, id: string): Follow | undefined {
  const row = ctx.db.query('SELECT * FROM follows WHERE id = ?').get(id) as FollowRow | null;
  return row === null ? undefined : followFromRow(row);
}

export function findFollow(ctx: Ctx, source: SourceId, kind: string, externalId: string): Follow | undefined {
  const row = ctx.db.query('SELECT * FROM follows WHERE source = ? AND kind = ? AND external_id = ?').get(source, kind, externalId) as FollowRow | null;
  return row === null ? undefined : followFromRow(row);
}

export function resolveFollowRef(ctx: Ctx, ref: string): Follow {
  const direct = getFollow(ctx, ref.trim());
  if (direct !== undefined) return direct;
  const ids = (ctx.db.query('SELECT id FROM follows').all() as Array<{id: string}>).map(r => r.id);
  const match = resolveIdPrefix(ids, ref);
  if (match.kind === 'ok') return getFollow(ctx, match.id)!;
  if (match.kind === 'ambiguous') throw new AppError(`"${ref}" matches more than one follow`, EXIT_USAGE, {candidates: match.candidates});
  throw notFound(`no follow "${ref}"`);
}

export function listFollows(ctx: Ctx, filter: {source?: SourceId; status?: FollowStatus} = {}): Follow[] {
  const enabled = ctx.sources.enabled;
  const where = [`source IN (${enabled.map(() => '?').join(',') || "''"})`];
  const params: string[] = [...enabled];
  if (filter.source !== undefined) {
    where.push('source = ?');
    params.push(filter.source);
  }
  if (filter.status !== undefined) {
    where.push('status = ?');
    params.push(filter.status);
  }
  const rows = ctx.db.query(`SELECT * FROM follows WHERE ${where.join(' AND ')} ORDER BY source, status, added`).all(...params) as FollowRow[];
  return rows.map(followFromRow);
}

/** Which follow kinds are screened by default (their items wait for the agent). */
export function screenedByDefault(source: SourceId, kind: string): boolean {
  if (source === 'papers') return kind === 'category' || kind === 'query';
  return source === 'docs';
}

export interface NewFollow {
  source: SourceId;
  candidate: FollowCandidate;
  status: FollowStatus;
  note?: string;
  screened?: boolean;
}

/** Create a follow, or update the status/note of one that exists. Returns it and whether it was new. */
export function upsertFollow(ctx: Ctx, input: NewFollow): {follow: Follow; existing: boolean} {
  const source = ctx.sources.get(input.source);
  const {candidate} = input;
  if (!source.followKinds.includes(candidate.kind)) {
    throw usageError(`${source.label.name} follows are ${source.followKinds.join(', ')}, not "${candidate.kind}"`);
  }
  const existing = findFollow(ctx, input.source, candidate.kind, candidate.external_id);
  if (existing !== undefined) {
    const note = input.note ?? existing.note;
    const screened = input.screened ?? existing.screened;
    ctx.db.query('UPDATE follows SET status = ?, note = ?, screened = ? WHERE id = ?').run(input.status, note, screened ? 1 : 0, existing.id);
    const follow = getFollow(ctx, existing.id)!;
    if (existing.status !== follow.status || existing.note !== follow.note || existing.screened !== follow.screened) {
      ctx.event('follow', follow.id, {kind: input.status === 'blocked' ? 'blocked' : 'following', title: follow.title, source: follow.source});
    }
    return {follow, existing: true};
  }
  const id = ctx.newId();
  ctx.db
    .query(
      `INSERT INTO follows (id, source, kind, external_id, title, url, status, note, fetched_by, screened, added)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.source,
      candidate.kind,
      candidate.external_id,
      candidate.title,
      candidate.url,
      input.status,
      input.note ?? '',
      source.fetchedBy,
      (input.screened ?? screenedByDefault(input.source, candidate.kind)) ? 1 : 0,
      ctx.now(),
    );
  const follow = getFollow(ctx, id)!;
  ctx.event('follow', id, {kind: input.status === 'blocked' ? 'blocked' : 'followed', title: follow.title, source: follow.source});
  return {follow, existing: false};
}

export function updateFollow(ctx: Ctx, follow: Follow, changes: {note?: string; screened?: boolean; status?: FollowStatus; title?: string}): Follow {
  ctx.db
    .query('UPDATE follows SET note = ?, screened = ?, status = ?, title = ? WHERE id = ?')
    .run(changes.note ?? follow.note, (changes.screened ?? follow.screened) ? 1 : 0, changes.status ?? follow.status, changes.title ?? follow.title, follow.id);
  const updated = getFollow(ctx, follow.id)!;
  ctx.event('follow', follow.id, {kind: 'changed', title: updated.title, status: updated.status});
  return updated;
}

/** Stop following. The row goes; items it brought in stay, unlinked. */
export function unfollow(ctx: Ctx, follow: Follow): void {
  ctx.db.query('UPDATE items SET follow_id = NULL WHERE follow_id = ?').run(follow.id);
  ctx.db.query('UPDATE feedback SET follow_id = NULL WHERE follow_id = ?').run(follow.id);
  ctx.db.query('DELETE FROM intake WHERE follow_id = ?').run(follow.id);
  ctx.db.query('DELETE FROM follows WHERE id = ?').run(follow.id);
  ctx.event('follow', follow.id, {kind: 'unfollowed', title: follow.title, source: follow.source});
}

/** The follow kind a source's creators are: YouTube channels, paper and doc authors. */
export function creatorKind(source: SourceId): string {
  return source === 'youtube' ? 'channel' : 'author';
}

/** Block whoever made an item. */
export function blockCreatorOf(ctx: Ctx, item: Item): Follow {
  if (item.creator_external_id === null) {
    throw new AppError(`cannot block the creator of "${item.title || item.url}": who made it is not known`, 1);
  }
  const candidate: FollowCandidate = {
    kind: creatorKind(item.source),
    external_id: item.creator_external_id,
    title: item.creator || item.creator_external_id,
    url: null,
  };
  return upsertFollow(ctx, {source: item.source, candidate, status: 'blocked'}).follow;
}

/** Whether a creator is blocked on a source. */
export function isCreatorBlocked(ctx: Ctx, source: SourceId, creatorExternalId: string | null | undefined): boolean {
  if (creatorExternalId === null || creatorExternalId === undefined) return false;
  return ctx.db.query("SELECT 1 FROM follows WHERE source = ? AND kind = ? AND external_id = ? AND status = 'blocked'").get(source, creatorKind(source), creatorExternalId) !== null;
}

export function setCursor(ctx: Ctx, follow: Follow, value: string): Follow {
  if (follow.fetched_by !== 'agent') throw usageError(`only agent-fed follows have a cursor the agent moves; ${follow.title} is polled by the app`);
  ctx.db.query('UPDATE follows SET cursor = ?, last_checked = ? WHERE id = ?').run(value, ctx.now(), follow.id);
  ctx.event('follow', follow.id, {kind: 'cursor', title: follow.title, cursor: value});
  return getFollow(ctx, follow.id)!;
}
