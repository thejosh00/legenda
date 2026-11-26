import {expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dailyBackup, toPrune} from '../../src/db/backup.ts';
import {openDatabase} from '../../src/db/database.ts';
import {serveCommand, serviceCommand, serviceLabel, servicePlist} from '../../src/local/service.ts';

test('each instance gets its own launchd label', () => {
  expect(serviceLabel('/Users/me/.legenda')).toBe('com.legenda.serve');
  expect(serviceLabel('/Users/me/.legenda-work')).toBe('com.legenda.serve.legenda-work');
  expect(serviceLabel('/srv/Work Instance')).toBe('com.legenda.serve.work-instance');
});

test('the plist runs serve with the data directory', () => {
  const plist = servicePlist({label: 'com.legenda.serve', command: ['/bin/bun', '/x/cli.ts', 'serve', '--port', '7779'], dataDir: '/d & e', logPath: '/d/l', path: '/bin'});
  expect(plist).toContain('<string>--port</string>');
  expect(plist).toContain('<key>LEGENDA_DIR</key>\n\t\t<string>/d &amp; e</string>');
});

test('the serve command prefers bun on PATH', () => {
  expect(serveCommand('/opt/homebrew/Cellar/bun/1.4/bin/bun', '/x/cli.ts', [], '/opt/homebrew/bin/bun')).toEqual(['/opt/homebrew/bin/bun', '/x/cli.ts', 'serve']);
  expect(serveCommand('/usr/local/bin/legenda', '/x/cli.ts', ['--port', '1'])).toEqual(['/usr/local/bin/legenda', 'serve', '--port', '1']);
});

test('install writes the agent and bootstraps it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legenda-svc-'));
  const calls: string[][] = [];
  const out: string[] = [];
  const code = serviceCommand(
    {dataDir: join(dir, '.legenda-work'), agentsDir: join(dir, 'agents'), platform: 'darwin', uid: 501, execPath: '/usr/local/bin/legenda', out: l => out.push(l ?? ''), err: () => {}, launchctl: args => (calls.push(args), {code: args[0] === 'print' ? 1 : 0, stdout: '', stderr: ''})},
    ['install', '--port', '7779'],
  );
  expect(code).toBe(0);
  expect(readdirSync(join(dir, 'agents'))).toEqual(['com.legenda.serve.legenda-work.plist']);
  expect(calls.at(-1)).toEqual(['bootstrap', 'gui/501', join(dir, 'agents', 'com.legenda.serve.legenda-work.plist')]);
});

test('daily backups: one a day, pruned to the newest', () => {
  expect(toPrune(['legenda-2026-01-01.db', 'legenda-2026-01-03.db', 'legenda-2026-01-02.db', 'other.db'], 2)).toEqual(['legenda-2026-01-01.db']);
  const dir = mkdtempSync(join(tmpdir(), 'legenda-bk-'));
  const db = openDatabase(join(dir, 'legenda.db'));
  expect(dailyBackup(db, dir, new Date('2026-09-12T15:00:00Z'))).toContain('legenda-2026-09-12.db');
  expect(dailyBackup(db, dir, new Date('2026-09-12T18:00:00Z'))).toBeUndefined();
  for (const day of ['2026-09-09', '2026-09-10', '2026-09-11']) writeFileSync(join(dir, 'backups', `legenda-${day}.db`), '');
  dailyBackup(db, dir, new Date('2026-09-13T15:00:00Z'), 2);
  expect(readdirSync(join(dir, 'backups')).sort()).toEqual(['legenda-2026-09-12.db', 'legenda-2026-09-13.db']);
  db.close();
});

/** `legenda service status` against a data folder whose newest daily backup was written `hours` ago (none when undefined). */
function status(options: {backupHours?: number; labelledHours?: number; dbHours?: number; installed?: boolean}) {
  const dir = mkdtempSync(join(tmpdir(), 'legenda-status-'));
  const now = new Date('2026-09-12T15:00:00Z');
  const write = (path: string, hours: number) => {
    writeFileSync(path, '');
    const at = new Date(now.getTime() - hours * 3_600_000);
    utimesSync(path, at, at);
    return at;
  };
  mkdirSync(join(dir, 'backups'));
  mkdirSync(join(dir, 'agents'));
  // macOS moves a file's creation time back with its modification time, which is what makes the database "old".
  write(join(dir, 'legenda.db'), options.dbHours ?? 1000);
  const written = options.backupHours === undefined ? undefined : write(join(dir, 'backups', 'legenda-2026-09-10.db'), options.backupHours);
  if (options.labelledHours !== undefined) write(join(dir, 'backups', 'legenda-label-pre-migration-v3-20260912T140000.db'), options.labelledHours);
  if (options.installed !== false) writeFileSync(join(dir, 'agents', `${serviceLabel(dir)}.plist`), '');
  const out: string[] = [];
  const code = serviceCommand(
    {dataDir: dir, agentsDir: join(dir, 'agents'), platform: 'darwin', uid: 501, now: () => now, out: l => out.push(l ?? ''), err: () => {}, launchctl: () => ({code: 0, stdout: 'pid = 42', stderr: ''})},
    ['status'],
  );
  return {code, out, written};
}

test('service status warns and exits 1 when the daily backup is stale, running or not', () => {
  const stale = status({backupHours: 37});
  expect(stale.out[0]).toBe('running, pid 42');
  expect(stale.out[1]).toStartWith('last backup: legenda-2026-09-10.db');
  expect(stale.out[2]).toBe(`warning: no backup since ${stale.written!.toLocaleString()}: see serve.log`);
  expect(stale.code).toBe(1);
  // A fresh pre-migration backup beside it changes nothing.
  expect(status({backupHours: 37, labelledHours: 1}).code).toBe(1);
  // Not installed (legenda serve under another supervisor): the backups are still the folder's.
  const bare = status({backupHours: 37, installed: false});
  expect(bare.out[0]).toBe('not installed');
  expect(bare.out.some(line => line.startsWith('warning: no backup since'))).toBe(true);
  expect(bare.code).toBe(1);
});

test('service status exits 0 without a warning when the daily backup is fresh', () => {
  const fresh = status({backupHours: 35});
  expect(fresh.out.some(line => line.startsWith('warning'))).toBe(false);
  expect(fresh.out[1]).toStartWith('last backup: legenda-2026-09-10.db');
  expect(fresh.code).toBe(0);
});

test('service status with no daily backup warns only when the database is itself more than 36 hours old', () => {
  const old = status({dbHours: 37});
  expect(old.out).toContain('no backups yet');
  expect(old.out).toContain('warning: no backup has been taken: see serve.log');
  expect(old.code).toBe(1);
  const young = status({dbHours: 35});
  expect(young.out).toContain('no backups yet');
  expect(young.out.some(line => line.startsWith('warning'))).toBe(false);
  expect(young.code).toBe(0);
});
