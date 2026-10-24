/**
 * R2: an instance's data is the user's alone — the data and backup directories 0700,
 * the database, its -wal and -shm, the backups and the token file (client.json) 0600.
 * New ones are made that way, and `legenda serve` tightens what an older version left
 * looser. It also listens on 127.0.0.1 unless told otherwise.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Database} from 'bun:sqlite';
import {run, type ServeRequest} from '../../src/cli.ts';
import {CLIENT_FILE, writeClientFile} from '../../src/client.ts';
import {SETTINGS} from '../../src/core/settings.ts';
import {BACKUP_DIR, takeBackup} from '../../src/db/backup.ts';
import {DB_FILE, openDatabase} from '../../src/db/database.ts';
import {dbFiles, secureDataDir} from '../../src/db/fileModes.ts';
import {setSetting} from '../../src/db/settings.ts';

let root: string;
let open: Database[] = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'legenda-modes-'));
});
afterEach(() => {
  for (const db of open) db.close();
  open = [];
  rmSync(root, {recursive: true, force: true});
});

const mode = (path: string) => statSync(path).mode & 0o777;

/** `legenda serve` with the blocking server swapped out; what it would have served. */
async function serveOnce(dir: string, argv: string[] = []): Promise<ServeRequest> {
  let seen: ServeRequest | undefined;
  const code = await run({
    argv: ['serve', ...argv],
    out: () => {},
    err: () => {},
    env: {LEGENDA_DIR: dir},
    serve: async request => {
      seen = request;
      return 0;
    },
  });
  expect(code).toBe(0);
  return seen!;
}

test('with no listen_host set, legenda serve listens on 127.0.0.1 only', async () => {
  expect(SETTINGS['listen_host']!.default).toBe('127.0.0.1');
  const dir = join(root, 'data');
  expect((await serveOnce(dir)).hostname).toBe('127.0.0.1');
  // Network access is an explicit choice.
  const db = openDatabase(join(dir, DB_FILE));
  setSetting(db, 'listen_host', '0.0.0.0');
  db.close();
  expect((await serveOnce(dir)).hostname).toBe('0.0.0.0');
  expect((await serveOnce(dir, ['--host', '127.0.0.1'])).hostname).toBe('127.0.0.1');
});

test('a new data directory, database, -wal and -shm are created private', () => {
  const dir = join(root, 'fresh');
  const path = join(dir, DB_FILE);
  const db = openDatabase(path);
  open.push(db);
  db.exec("INSERT INTO settings (key, value) VALUES ('x', 'y')");
  expect(mode(dir)).toBe(0o700);
  for (const file of dbFiles(path)) expect(mode(file)).toBe(0o600);
});

test('backups and their directory are created private', () => {
  const db = openDatabase(join(root, DB_FILE));
  open.push(db);
  const backup = takeBackup(db, join(root, BACKUP_DIR), 'legenda-2026-09-12.db');
  expect(mode(join(root, BACKUP_DIR))).toBe(0o700);
  expect(mode(backup)).toBe(0o600);
});

test('the token file is written private', () => {
  const path = writeClientFile(join(root, 'client'), {url: 'http://127.0.0.1:7778', token: 'lg_x'});
  expect(mode(join(root, 'client'))).toBe(0o700);
  expect(mode(path)).toBe(0o600);
});

test('after legenda serve starts on a data dir with 0644 files, the dirs are 0700 and the files 0600', async () => {
  const dir = join(root, 'old');
  const path = join(dir, DB_FILE);
  // What an older version left: everything readable by everyone. Kept open so the
  // -wal and -shm exist, as they do beside a running server.
  const db = openDatabase(path);
  open.push(db);
  db.exec("INSERT INTO settings (key, value) VALUES ('x', 'y')");
  writeFileSync(join(dir, CLIENT_FILE), '{}\n');
  mkdirSync(join(dir, BACKUP_DIR));
  writeFileSync(join(dir, BACKUP_DIR, 'legenda-2026-09-11.db'), '');
  const files = [...dbFiles(path), join(dir, CLIENT_FILE), join(dir, BACKUP_DIR, 'legenda-2026-09-11.db')];
  for (const file of files) chmodSync(file, 0o644);
  chmodSync(dir, 0o755);
  chmodSync(join(dir, BACKUP_DIR), 0o755);

  await serveOnce(dir);

  expect(mode(dir)).toBe(0o700);
  expect(mode(join(dir, BACKUP_DIR))).toBe(0o700);
  for (const file of files) expect(mode(file)).toBe(0o600);
});

test('tightening is idempotent and never loosens', () => {
  const dir = join(root, 'tight');
  mkdirSync(dir, {mode: 0o755});
  chmodSync(dir, 0o755);
  writeFileSync(join(dir, DB_FILE), '');
  chmodSync(join(dir, DB_FILE), 0o400);
  const layout = {dataDir: dir, files: [...dbFiles(DB_FILE), CLIENT_FILE], dirs: [BACKUP_DIR]};
  expect(secureDataDir(layout)).toEqual([dir]);
  expect(secureDataDir(layout)).toEqual([]);
  expect(mode(dir)).toBe(0o700);
  expect(mode(join(dir, DB_FILE))).toBe(0o400);
});
