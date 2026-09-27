/**
 * Curator runs: one row per run, so the user can see what the agent did and why.
 *
 * One open run per actor. A run left open by a crash is resumed if it is recent (so a
 * retried wake carries on where it left off) and closed as failed if it is stale.
 */
import {AppError, EXIT_USAGE, notFound, usageError} from '../core/errors.ts';
import {addDaysIso} from '../core/time.ts';
import type {Item} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {itemFromRow} from './items.ts';

export const RUN_OUTCOMES = ['ok', 'partial', 'needs_auth', 'failed'] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];
const STALE_HOURS = 12;

export interface Run {
  id: string;
  actor: string;
  started: string;
  finished: string | null;
  outcome: RunOutcome | null;
  queries: unknown;
  considered: number;
  suggested: number;
  from_follows: number;
  summary: string;
}

interface RunRow extends Omit<Run, 'queries'> {
  queries: string;
}

const runFromRow = (row: RunRow): Run => {
  let queries: unknown = [];
  try {
    queries = JSON.parse(row.queries);
  } catch {
    queries = row.queries;
  }
  return {...row, queries};
};

export function getRun(ctx: Ctx, id: string): Run | undefined {
  const row = ctx.db.query('SELECT * FROM agent_runs WHERE id = ?').get(id.trim()) as RunRow | null;
  return row === null ? undefined : runFromRow(row);
}

export function openRunOf(ctx: Ctx): Run | undefined {
  const row = ctx.db.query('SELECT * FROM agent_runs WHERE actor = ? AND finished IS NULL ORDER BY started DESC LIMIT 1').get(ctx.actor) as RunRow | null;
  return row === null ? undefined : runFromRow(row);
}

export function startRun(ctx: Ctx): {run: Run; resumed: boolean} {
  const open = openRunOf(ctx);
  if (open !== undefined) {
    const staleBefore = new Date(new Date(ctx.now()).getTime() - STALE_HOURS * 3_600_000).toISOString();
    if (open.started >= staleBefore) return {run: open, resumed: true};
    ctx.db
      .query("UPDATE agent_runs SET finished = ?, outcome = 'failed', summary = CASE WHEN summary = '' THEN 'abandoned: never finished' ELSE summary END WHERE id = ?")
      .run(ctx.now(), open.id);
    ctx.event('run', open.id, {kind: 'abandoned'});
  }
  const id = ctx.newId();
  ctx.db.query('INSERT INTO agent_runs (id, actor, started) VALUES (?, ?, ?)').run(id, ctx.actor, ctx.now());
  ctx.event('run', id, {kind: 'started'});
  return {run: getRun(ctx, id)!, resumed: false};
}

/** The caller's open run with this id, or a usage error saying what is wrong. */
export function requireOpenRun(ctx: Ctx, id: string | undefined): Run {
  if (id === undefined || id.trim() === '') throw usageError('which run? pass --run <run_id> from "legenda run start"');
  const run = getRun(ctx, id);
  if (run === undefined) throw notFound(`no run "${id}"`);
  if (run.actor !== ctx.actor) throw new AppError(`run ${run.id} belongs to ${run.actor}`, EXIT_USAGE);
  if (run.finished !== null) throw new AppError(`run ${run.id} is already finished; start a new one`, EXIT_USAGE);
  return run;
}

export function finishRun(
  ctx: Ctx,
  id: string,
  input: {outcome: string; queries?: unknown; considered?: number; summary?: string},
): Run {
  const run = requireOpenRun(ctx, id);
  if (!(RUN_OUTCOMES as readonly string[]).includes(input.outcome)) throw usageError(`outcome must be one of ${RUN_OUTCOMES.join(', ')}`);
  ctx.db
    .query('UPDATE agent_runs SET finished = ?, outcome = ?, queries = ?, considered = ?, summary = ? WHERE id = ?')
    .run(ctx.now(), input.outcome, JSON.stringify(input.queries ?? []), input.considered ?? 0, input.summary?.trim() ?? '', run.id);
  const finished = getRun(ctx, run.id)!;
  ctx.event('run', run.id, {kind: 'finished', outcome: finished.outcome, suggested: finished.suggested, from_follows: finished.from_follows});
  return finished;
}

export function listRuns(ctx: Ctx, limit = 30): Run[] {
  return (ctx.db.query('SELECT * FROM agent_runs ORDER BY started DESC LIMIT ?').all(limit) as RunRow[]).map(runFromRow);
}

export function runItems(ctx: Ctx, runId: string): Item[] {
  return (ctx.db.query('SELECT * FROM items WHERE run_id = ? ORDER BY added').all(runId) as Parameters<typeof itemFromRow>[0][]).map(itemFromRow);
}

export function recentRuns(ctx: Ctx, count: number): Array<Pick<Run, 'id' | 'started' | 'finished' | 'outcome' | 'summary' | 'suggested' | 'from_follows'>> {
  return listRuns(ctx, count).map(r => ({id: r.id, started: r.started, finished: r.finished, outcome: r.outcome, summary: r.summary, suggested: r.suggested, from_follows: r.from_follows}));
}

export const since90Days = (ctx: Ctx) => addDaysIso(ctx.now(), -90);
