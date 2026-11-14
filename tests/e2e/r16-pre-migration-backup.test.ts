/**
 * R16: migrations only go forward and run on the user's real data when the server
 * restarts, so an existing database is backed up, at its old version, before the first
 * pending migration, under a name the daily prune never touches.
 */
import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BACKUP_DIR, dailyBackup} from '../../src/db/backup.ts';
import {DB_FILE, MIGRATIONS, SCHEMA_VERSION, openDatabase} from '../../src/db/database.ts';

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legenda-r16-'));
  path = join(dir, DB_FILE);
});
afterEach(() => rmSync(dir, {recursive: true, force: true}));

/** The next build: today's migrations and one more. */
const NEXT = [...MIGRATIONS, 'CREATE TABLE r16_later (id TEXT PRIMARY KEY)'];

const versionOf = (file: string) => {
  const db = new Database(file, {readonly: true});
  try {
    return (db.query('PRAGMA user_version').get() as {user_version: number}).user_version;
  } finally {
    db.close();
  }
};

test('an older file-backed database is backed up once, at its old version, before it is migrated', () => {
  openDatabase(path).close();
  expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);

  openDatabase(path, {migrations: NEXT}).close();

  const names = readdirSync(join(dir, BACKUP_DIR));
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(new RegExp(`^legenda-label-pre-migration-v${SCHEMA_VERSION}-\\d{8}T\\d{6}\\.db$`));
  expect(versionOf(join(dir, BACKUP_DIR, names[0]!))).toBe(SCHEMA_VERSION);
  expect(versionOf(path)).toBe(SCHEMA_VERSION + 1);
  // Already current: opening again takes no second backup.
  openDatabase(path, {migrations: NEXT}).close();
  expect(readdirSync(join(dir, BACKUP_DIR))).toHaveLength(1);
});

test('a brand-new database and :memory: are not backed up', () => {
  openDatabase(path, {migrations: NEXT}).close();
  expect(versionOf(path)).toBe(SCHEMA_VERSION + 1);
  expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);

  const before = readdirSync(process.cwd()).sort();
  openDatabase(':memory:', {migrations: NEXT}).close();
  expect(readdirSync(process.cwd()).sort()).toEqual(before);
  expect(existsSync(join(dir, BACKUP_DIR))).toBe(false);
});

test('a daily prune past the keep count leaves the pre-migration backup in place', () => {
  openDatabase(path).close();
  const db = openDatabase(path, {migrations: NEXT});
  const [label] = readdirSync(join(dir, BACKUP_DIR));
  expect(label).toStartWith('legenda-label-pre-migration-v');

  for (const day of ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']) dailyBackup(db, dir, new Date(`${day}T18:00:00Z`), 2);
  db.close();

  expect(readdirSync(join(dir, BACKUP_DIR)).sort()).toEqual(['legenda-2026-09-12.db', 'legenda-2026-09-13.db', label!]);
});
