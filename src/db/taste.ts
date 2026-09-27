/**
 * Taste: the user's interests, in their words, and the agent's working profile of them.
 */
import {AppError, EXIT_USAGE, notFound, usageError} from '../core/errors.ts';
import {isSourceId, type SourceId} from '../core/types.ts';
import type {Ctx} from './context.ts';
import {numberSetting} from './settings.ts';

export const STRENGTHS = ['core', 'curious', 'avoid'] as const;
export type Strength = (typeof STRENGTHS)[number];

export interface Interest {
  id: string;
  topic: string;
  strength: Strength;
  sources: SourceId[];
  note: string;
  added: string;
}

interface InterestRow extends Omit<Interest, 'sources'> {
  sources: string;
}

const interestFromRow = (row: InterestRow): Interest => ({...row, sources: (JSON.parse(row.sources) as string[]).filter(isSourceId)});

export function listInterests(ctx: Ctx): Interest[] {
  return (ctx.db.query("SELECT * FROM interests ORDER BY CASE strength WHEN 'core' THEN 0 WHEN 'curious' THEN 1 ELSE 2 END, added").all() as InterestRow[]).map(interestFromRow);
}

export function addInterest(ctx: Ctx, input: {topic: string; strength: string; sources: string[]; note?: string}): Interest {
  const topic = input.topic.trim();
  if (topic === '') throw usageError('an interest needs a topic');
  if (!(STRENGTHS as readonly string[]).includes(input.strength)) throw usageError('strength must be core, curious or avoid');
  const bad = input.sources.filter(s => !isSourceId(s));
  if (bad.length > 0) throw usageError(`unknown source ${bad.join(', ')}`);
  const id = ctx.newId();
  ctx.db
    .query('INSERT INTO interests (id, topic, strength, sources, note, added) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, topic, input.strength, JSON.stringify([...new Set(input.sources)]), input.note?.trim() ?? '', ctx.now());
  ctx.event('interest', id, {kind: 'added', topic, strength: input.strength});
  return listInterests(ctx).find(i => i.id === id)!;
}

export function removeInterest(ctx: Ctx, ref: string): Interest {
  const found = listInterests(ctx).filter(i => i.id === ref || i.id.startsWith(ref) || i.topic.toLowerCase() === ref.trim().toLowerCase());
  if (found.length === 0) throw notFound(`no interest "${ref}"`);
  if (found.length > 1) throw new AppError(`"${ref}" matches more than one interest`, EXIT_USAGE, {candidates: found.map(i => `${i.id}  ${i.topic}`)});
  const interest = found[0]!;
  ctx.db.query('DELETE FROM interests WHERE id = ?').run(interest.id);
  ctx.event('interest', interest.id, {kind: 'removed', topic: interest.topic});
  return interest;
}

export interface ProfileVersion {
  version: number;
  body: string;
  actor: string;
  note: string;
  at: string;
}

export function latestProfile(ctx: Ctx): ProfileVersion | null {
  return (ctx.db.query('SELECT * FROM profile_versions ORDER BY version DESC LIMIT 1').get() as ProfileVersion | null) ?? null;
}

export function profileHistory(ctx: Ctx): ProfileVersion[] {
  return ctx.db.query('SELECT * FROM profile_versions ORDER BY version DESC').all() as ProfileVersion[];
}

export function setProfile(ctx: Ctx, body: string, note: string): {profile: ProfileVersion; changed: boolean} {
  const max = numberSetting(ctx.db, 'profile_max_bytes');
  const size = new TextEncoder().encode(body).length;
  if (size > max) throw new AppError(`the profile is ${size} bytes; the cap is ${max} (profile_max_bytes). Make it more concise.`, 1);
  if (ctx.isAgent && note.trim() === '') throw usageError('say what changed and why: --note "…"');
  const latest = latestProfile(ctx);
  if (latest !== null && latest.body === body) return {profile: latest, changed: false};
  const version = (latest?.version ?? 0) + 1;
  ctx.db.query('INSERT INTO profile_versions (version, body, actor, note, at) VALUES (?, ?, ?, ?, ?)').run(version, body, ctx.actor, note.trim(), ctx.now());
  ctx.event('profile', String(version), {kind: 'changed', version, note: note.trim()});
  return {profile: latestProfile(ctx)!, changed: true};
}
