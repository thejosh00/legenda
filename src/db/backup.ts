/**
 * The daily backup.
 *
 * Everything lives in one file, so yesterday's copy of it is the way back from a bad
 * day. Whenever the server runs it checks whether today's backup exists (a laptop asleep
 * at 3am would skip a fixed-time job), and keeps the last fortnight.
 *
 * `VACUUM INTO` writes a consistent snapshot even while others write; the copy is only
 * renamed into place after it passes an integrity check.
 */
import {existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {Database} from 'bun:sqlite';
import {localDate} from '../core/time.ts';

export const BACKUP_DIR = 'backups';
export const KEEP_DAILY = 14;
const DAILY = /^legenda-(\d{4}-\d{2}-\d{2})\.db$/;

export const dailyName = (at: Date) => `legenda-${localDate(at)}.db`;
export const backupDir = (dataDir: string) => join(dataDir, BACKUP_DIR);

/** Daily backups beyond the newest `keep`, oldest first. */
export function toPrune(names: readonly string[], keep: number): string[] {
  const daily = names.filter(name => DAILY.test(name)).sort();
  return daily.slice(0, Math.max(0, daily.length - keep));
}

export function takeBackup(db: Database, dir: string, name: string): string {
  mkdirSync(dir, {recursive: true});
  const target = join(dir, name);
  const temp = join(dir, `.${name}.partial`);
  if (existsSync(temp)) unlinkSync(temp);
  try {
    db.query('VACUUM INTO ?').run(temp);
    const copy = new Database(temp, {readonly: true});
    try {
      const result = copy.query('PRAGMA quick_check').get() as {quick_check: string} | null;
      if (result?.quick_check !== 'ok') throw new Error(`the copy failed its check: ${result?.quick_check ?? 'no answer'}`);
    } finally {
      copy.close();
    }
    renameSync(temp, target);
    return target;
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
}

/** Take today's backup if there is none yet, and prune. The new path, or undefined. */
export function dailyBackup(db: Database, dataDir: string, now: Date, keep = KEEP_DAILY): string | undefined {
  const dir = backupDir(dataDir);
  const name = dailyName(now);
  if (existsSync(join(dir, name))) return undefined;
  const path = takeBackup(db, dir, name);
  for (const old of toPrune(readdirSync(dir), keep)) unlinkSync(join(dir, old));
  return path;
}

export function latestBackup(dataDir: string): {name: string; modified: Date} | undefined {
  const dir = backupDir(dataDir);
  if (!existsSync(dir)) return undefined;
  const names = readdirSync(dir).filter(n => DAILY.test(n)).sort();
  const name = names[names.length - 1];
  return name === undefined ? undefined : {name, modified: statSync(join(dir, name)).mtime};
}
