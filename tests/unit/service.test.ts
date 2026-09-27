import {expect, test} from 'bun:test';
import {mkdtempSync, readdirSync} from 'node:fs';
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
  db.close();
});
