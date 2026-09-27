/**
 * Screened intake: candidates from screened follows, waiting for the curator to judge
 * them against the follow's note. Accepted ones join the list as follow items; passed
 * ones are remembered so they are not offered again; undecided ones expire.
 */
import {AppError, EXIT_ERROR, notFound, usageError} from '../core/errors.ts';
import {addDaysIso, startOfLocalDayIso} from '../core/time.ts';
import type {Follow, ItemInput, SourceId} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {getFollow} from './follows.ts';
import {findKnownItem, insertItem, refsOf, type Added} from './items.ts';
import {numberSetting} from './settings.ts';

export const INTAKE_EXPIRY_DAYS = 14;

interface IntakeRow {
  id: string;
  follow_id: string;
  item: string;
  seen: string;
  decided: string | null;
  decided_at: string | null;
}

export interface IntakeJson {
  id: string;
  follow: {id: string; title: string; kind: string; note: string} | null;
  item: ItemInput;
  seen: string;
  decided: string | null;
  decided_at: string | null;
}

function toJson(ctx: Ctx, row: IntakeRow): IntakeJson {
  const follow = getFollow(ctx, row.follow_id);
  return {
    id: row.id,
    follow: follow === undefined ? null : {id: follow.id, title: follow.title, kind: follow.kind, note: follow.note},
    item: JSON.parse(row.item) as ItemInput,
    seen: row.seen,
    decided: row.decided,
    decided_at: row.decided_at,
  };
}

/** Whether a candidate for this source+id is already waiting or was decided. */
function alreadyOffered(ctx: Ctx, source: SourceId, externalId: string): boolean {
  return (
    ctx.db
      .query(
        `SELECT 1 FROM intake WHERE json_extract(item, '$.source') = ? AND (json_extract(item, '$.external_id') = ?
           OR EXISTS (SELECT 1 FROM json_each(intake.item, '$.extra.refs') WHERE json_each.value = ?)) LIMIT 1`,
      )
      .get(source, externalId, externalId) !== null
  );
}

/** Offer a candidate for screening. False if it is already known or offered. */
export function offerCandidate(ctx: Ctx, follow: Follow, item: ItemInput): boolean {
  if (findKnownItem(ctx, item) !== undefined) return false;
  if (refsOf(item).some(ref => alreadyOffered(ctx, item.source, ref))) return false;
  const id = ctx.newId();
  ctx.db.query('INSERT INTO intake (id, follow_id, item, seen) VALUES (?, ?, ?, ?)').run(id, follow.id, JSON.stringify(item), ctx.now());
  ctx.event('intake', id, {kind: 'offered', title: item.title, follow_id: follow.id});
  return true;
}

export function pendingIntake(ctx: Ctx, source?: SourceId): IntakeJson[] {
  const enabled = ctx.sources.enabled;
  const rows = ctx.db
    .query(
      `SELECT intake.* FROM intake JOIN follows ON follows.id = intake.follow_id
       WHERE intake.decided IS NULL AND follows.source IN (${enabled.map(() => '?').join(',') || "''"}) ${source === undefined ? '' : 'AND follows.source = ?'}
       ORDER BY intake.seen, intake.rowid`,
    )
    .all(...enabled, ...(source === undefined ? [] : [source])) as IntakeRow[];
  return rows.map(row => toJson(ctx, row));
}

export function pendingIntakeCount(ctx: Ctx): number {
  return pendingIntake(ctx).length;
}

function getIntake(ctx: Ctx, id: string): IntakeRow {
  const row = ctx.db.query('SELECT * FROM intake WHERE id = ?').get(id.trim()) as IntakeRow | null;
  if (row === null) throw notFound(`no intake candidate "${id}"`);
  return row;
}

/** Follow items an agent added today (screened accepts and docs intake): what the cap counts. */
export function followIntakeToday(ctx: Ctx): number {
  const row = ctx.db
    .query("SELECT COUNT(*) AS n FROM items WHERE origin = 'follow' AND added_by LIKE 'agent:%' AND added >= ?")
    .get(startOfLocalDayIso(ctx.now())) as {n: number};
  return row.n;
}

/** Throw if an agent adding `count` more follow items would pass today's cap. */
export function checkFollowIntakeCap(ctx: Ctx, count = 1): void {
  if (!ctx.isAgent) return;
  const cap = numberSetting(ctx.db, 'daily_follow_intake_cap');
  const used = followIntakeToday(ctx);
  if (used + count > cap) {
    throw new AppError(`today's follow-intake cap is reached (${used} of ${cap}, daily_follow_intake_cap)`, EXIT_ERROR, {cap, used});
  }
}

export function acceptIntake(ctx: Ctx, id: string, reason: string, runId?: string): Added & {intake_id: string} {
  const row = getIntake(ctx, id);
  if (row.decided !== null) throw usageError(`intake ${row.id} was already ${row.decided}`);
  if (reason.trim() === '' && ctx.isAgent) throw usageError('say why it passes the follow\'s rule: --reason "…"');
  const input = JSON.parse(row.item) as ItemInput;
  const known = findKnownItem(ctx, input);
  if (known === undefined) checkFollowIntakeCap(ctx);
  const added = insertItem(ctx, input, {origin: 'follow', follow_id: row.follow_id, reason, run_id: runId ?? null});
  ctx.db.query("UPDATE intake SET decided = 'accepted', decided_at = ? WHERE id = ?").run(ctx.now(), row.id);
  ctx.event('intake', row.id, {kind: 'accepted', title: input.title, item_id: added.item.id});
  if (runId !== undefined && !added.existing) bumpRun(ctx, runId, 'from_follows');
  return {...added, intake_id: row.id};
}

export function passIntake(ctx: Ctx, id: string): {intake_id: string} {
  const row = getIntake(ctx, id);
  if (row.decided !== null) throw usageError(`intake ${row.id} was already ${row.decided}`);
  ctx.db.query("UPDATE intake SET decided = 'passed', decided_at = ? WHERE id = ?").run(ctx.now(), row.id);
  ctx.event('intake', row.id, {kind: 'passed'});
  return {intake_id: row.id};
}

/** Undecided candidates older than the expiry window stop being offered. */
export function expireIntake(ctx: Ctx): number {
  const cutoff = addDaysIso(ctx.now(), -INTAKE_EXPIRY_DAYS);
  return ctx.db.query("UPDATE intake SET decided = 'expired', decided_at = ? WHERE decided IS NULL AND seen < ?").run(ctx.now(), cutoff).changes;
}

/** Count something a run did, if the run is this actor's and still open. */
export function bumpRun(ctx: Ctx, runId: string, column: 'suggested' | 'from_follows'): void {
  ctx.db.query(`UPDATE agent_runs SET ${column} = ${column} + 1 WHERE id = ? AND actor = ? AND finished IS NULL`).run(runId, ctx.actor);
}
