/** R30: a daily backup that has stopped is said by whoami (I24). */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdirSync, utimesSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openDatabase} from '../../src/db/database.ts';
// The whole module, so that on a build without backupStatus each test fails on its own line, not the file at import.
import * as backups from '../../src/db/backup.ts';
import {startServer} from '../../src/server/server.ts';
import {createToken} from '../../src/db/auth.ts';
import {startInstance, T0, type Instance} from '../helpers/instance.ts';

const {BACKUP_STALE_MS, backupStatus, labelledName} = backups;
const HOUR = 3_600_000;
let lg: Instance;
beforeEach(async () => {
  lg = await startInstance();
});
afterEach(() => lg.stop());

/** A file in backups/, written `hours` before the instance's clock. */
function backupFile(name: string, hours: number): string {
  const dir = join(lg.dir, 'backups');
  mkdirSync(dir, {recursive: true});
  const written = new Date(Date.parse(lg.clock.now) - hours * HOUR);
  writeFileSync(join(dir, name), '');
  utimesSync(join(dir, name), written, written);
  return written.toISOString();
}

const whoami = async (token = lg.token('you')) => (await fetch(`${lg.url}/api/whoami`, {headers: {authorization: `Bearer ${token}`}})).json() as Promise<any>;

test('the one constant is 36 hours', () => {
  expect(BACKUP_STALE_MS).toBe(36 * HOUR);
});

test('whoami says the daily backup is stale past 36 hours, with its time, and not at 35', async () => {
  const written = backupFile('legenda-2026-09-10.db', 37);
  expect((await whoami()).backup).toEqual({last: written, stale: true});
  const fresher = backupFile('legenda-2026-09-10.db', 35);
  expect((await whoami()).backup).toEqual({last: fresher, stale: false});
  // The agent's token is told too; a stranger is told nothing.
  expect((await whoami(lg.token('agent:curator'))).backup).toEqual({last: fresher, stale: false});
  expect((await fetch(`${lg.url}/api/whoami`)).status).toBe(401);
});

test('a fresh pre-migration or labelled backup beside an old daily one is still stale', async () => {
  const written = backupFile('legenda-2026-09-10.db', 40);
  backupFile(labelledName('pre-migration-v3', T0), 1);
  backupFile(labelledName('before-cleanup', T0), 1);
  expect((await whoami()).backup).toEqual({last: written, stale: true});
});

test('with no daily backup at all, stale only once the server has been up that long', async () => {
  backupFile(labelledName('pre-migration-v3', T0), 1);
  expect((await whoami()).backup).toEqual({last: null, stale: false});
  lg.clock.now = new Date(Date.parse(T0) + 35 * HOUR).toISOString();
  expect((await whoami()).backup).toEqual({last: null, stale: false});
  lg.clock.now = new Date(Date.parse(T0) + 37 * HOUR).toISOString();
  expect((await whoami()).backup).toEqual({last: null, stale: true});
});

test('backupStatus is exact at the edge: 36 hours is not stale, a second more is', () => {
  const written = Date.parse(backupFile('legenda-2026-09-10.db', 0));
  const since = new Date(written);
  expect(backupStatus(lg.dir, new Date(written + BACKUP_STALE_MS), since).stale).toBe(false);
  expect(backupStatus(lg.dir, new Date(written + BACKUP_STALE_MS + 1000), since).stale).toBe(true);
});

test('a server with no data folder says nothing about backups', async () => {
  const db = openDatabase(':memory:');
  const server = startServer({db, port: 0, hostname: '127.0.0.1', now: () => T0});
  const token = createToken(db, 'you', T0);
  const who = (await (await fetch(`${server.url}/api/whoami`, {headers: {authorization: `Bearer ${token}`}})).json()) as any;
  expect(who.ok).toBe(true);
  expect('backup' in who).toBe(false);
  await server.stop();
  db.close();
});
