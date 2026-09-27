/**
 * What every server-side operation is handed: the database, who is asking, the clock,
 * the live-update hub, and the enabled sources wired to their network access.
 */
import type {Database} from 'bun:sqlite';
import {AppError, EXIT_ERROR} from '../core/errors.ts';
import {localDate} from '../core/time.ts';
import {isAgent, type Actor, type SourceId} from '../core/types.ts';
import type {RateGates} from '../sources/rateGate.ts';
import {Sources} from '../sources/registry.ts';
import type {Fetcher} from '../sources/types.ts';
import {recordEvent, type EventEntity, type EventHub} from './events.ts';
import {enabledSources, getSetting} from './settings.ts';
import {newId} from './ids.ts';

export interface AppDeps {
  db: Database;
  hub?: EventHub;
  now: () => string;
  fetcher: Fetcher;
  gates: RateGates;
}

export class Ctx {
  readonly db: Database;
  readonly hub: EventHub | undefined;
  readonly now: () => string;
  readonly fetcher: Fetcher;
  readonly gates: RateGates;
  private cachedSources: Sources | undefined;

  constructor(deps: AppDeps, readonly actor: Actor) {
    this.db = deps.db;
    this.hub = deps.hub;
    this.now = deps.now;
    this.fetcher = deps.fetcher;
    this.gates = deps.gates;
  }

  get isAgent(): boolean {
    return isAgent(this.actor);
  }

  get sources(): Sources {
    this.cachedSources ??= new Sources(
      id => ({
        fetcher: this.fetcher,
        setting: key => getSetting(this.db, key),
        spend: units => spendQuota(this, id, units),
        now: this.now,
        gate: (name, ms) => this.gates.wait(name, ms),
      }),
      enabledSources(this.db),
    );
    return this.cachedSources;
  }

  newId(): string {
    return newId(this.now());
  }

  event(entity: EventEntity, entityId: string, change: Record<string, unknown>): void {
    recordEvent(this.db, this.hub, {at: this.now(), actor: this.actor, entity, entity_id: entityId, change});
  }

  /** Run `fn` in one write transaction. */
  write<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
}

/** Daily units each source may spend; unlimited where there is no setting. */
function quotaCeiling(ctx: Ctx, source: SourceId): number | undefined {
  const value = getSetting(ctx.db, `${source}_daily_units`);
  return value === undefined ? undefined : Number(value);
}

export function quotaUsed(ctx: Ctx, source: SourceId): number {
  const row = ctx.db.query('SELECT units FROM api_usage WHERE day = ? AND source = ?').get(localDate(ctx.now()), source) as {units: number} | null;
  return row?.units ?? 0;
}

export function quotaLeft(ctx: Ctx, source: SourceId): number | null {
  const ceiling = quotaCeiling(ctx, source);
  return ceiling === undefined ? null : Math.max(0, ceiling - quotaUsed(ctx, source));
}

function spendQuota(ctx: Ctx, source: SourceId, units: number): void {
  const left = quotaLeft(ctx, source);
  if (left !== null && units > left) {
    throw new AppError(`the ${source} API quota for today is spent (${left} units left, ${units} needed); try again tomorrow`, EXIT_ERROR, {quota_left: left});
  }
  ctx.db
    .query('INSERT INTO api_usage (day, source, units) VALUES (?, ?, ?) ON CONFLICT(day, source) DO UPDATE SET units = units + excluded.units')
    .run(localDate(ctx.now()), source, units);
}
