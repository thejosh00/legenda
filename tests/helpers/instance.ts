/**
 * A whole legenda instance for a test: a temporary data directory, a real server on a
 * free port, and the real CLI run in-process against it over HTTP.
 *
 * The network is never touched: the server's fetcher is a `FakeWeb` that answers from
 * fixtures and fails loudly on anything it was not told about.
 */
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Database} from 'bun:sqlite';
import {run} from '../../src/cli.ts';
import {createToken} from '../../src/db/auth.ts';
import {Ctx} from '../../src/db/context.ts';
import {DB_FILE, openDatabase} from '../../src/db/database.ts';
import {setSetting} from '../../src/db/settings.ts';
import {startServer, type RunningServer} from '../../src/server/server.ts';
import {FakeWeb} from './fakeWeb.ts';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout parsed, when it is JSON. */
  json: any;
}

export interface Instance {
  dir: string;
  db: Database;
  web: FakeWeb;
  server: RunningServer;
  url: string;
  tokens: Record<string, string>;
  clock: {now: string};
  /** Run `legenda …`; `as` picks the actor's token (default `you`). */
  cli(args: string[], options?: {as?: string; stdin?: string; env?: Record<string, string>}): Promise<CliResult>;
  /** `cli` with `--json` added, asserting nothing. */
  j(args: string[], options?: {as?: string; stdin?: string}): Promise<CliResult>;
  ctx(actor?: string): Ctx;
  token(actor: string): string;
  stop(): Promise<void>;
}

export const T0 = '2026-09-12T15:00:00Z';

export async function startInstance(options: {now?: string; settings?: Record<string, string>} = {}): Promise<Instance> {
  const dir = mkdtempSync(join(tmpdir(), 'legenda-test-'));
  const db = openDatabase(join(dir, DB_FILE));
  for (const [key, value] of Object.entries(options.settings ?? {})) setSetting(db, key, value);
  const clock = {now: options.now ?? T0};
  const web = new FakeWeb();
  const server = startServer({db, port: 0, hostname: '127.0.0.1', now: () => clock.now, fetcher: web.fetcher});
  const tokens: Record<string, string> = {};
  const token = (actor: string) => (tokens[actor] ??= createToken(db, actor, clock.now));
  token('you');
  token('agent:curator');

  const cli: Instance['cli'] = async (args, opts = {}) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run({
      argv: args,
      out: line => stdout.push(line ?? ''),
      err: line => stderr.push(line ?? ''),
      env: {LEGENDA_DIR: dir, LEGENDA_URL: server.url, LEGENDA_TOKEN: token(opts.as ?? 'you'), ...opts.env},
      now: () => clock.now,
      readStdin: async () => opts.stdin ?? '',
    });
    const text = stdout.join('\n');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    return {code, stdout: text, stderr: stderr.join('\n'), json: parsed};
  };

  return {
    dir,
    db,
    web,
    server,
    url: server.url,
    tokens,
    clock,
    cli,
    j: (args, opts) => cli([...args, '--json'], opts),
    ctx: (actor = 'you') => new Ctx(server.deps, actor),
    token,
    async stop() {
      await server.stop();
      db.close();
      rmSync(dir, {recursive: true, force: true});
    },
  };
}
