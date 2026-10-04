#!/usr/bin/env bun
/**
 * The `legenda` command.
 *
 * A few commands run here, against this machine's data directory: `serve` starts the
 * server, `token` issues a token, `login` records where the server is. Everything else
 * is one HTTP call to the server — the CLI is a thin client, which is what lets the
 * curator in a sandbox use exactly the same commands as you.
 *
 * With `--json`, success and failure both arrive as JSON on stdout and stderr stays
 * empty: `{"ok":false,"error":"…","code":3}`.
 */
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {networkInterfaces, tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseArgs, flagValue, type ParsedArgs} from './core/args.ts';
import {AppError, EXIT_ERROR, EXIT_OK, EXIT_UNAVAILABLE, EXIT_USAGE, describe, failure} from './core/errors.ts';
import {nowIso} from './core/time.ts';
import {callApi, clientConfig, Unreachable, writeClientFile, type Fetch} from './client.ts';
import {dataDirFrom, DEFAULT_PORT} from './config.ts';
import {COMMANDS, matchCommand} from './commands/index.ts';
import {CommandUsage, type CommandDef} from './commands/types.ts';
import {createToken} from './db/auth.ts';
import {DB_FILE, openDatabase} from './db/database.ts';
import {getSetting} from './db/settings.ts';
import {VERSION} from './version.ts';

const LOCAL_COMMANDS: Array<[string, string]> = [
  ['serve', 'start the server and the web app  [--host H] [--port N] [--dev]'],
  ['service', 'keep the server running in the background (macOS): install|start|stop|restart|status|logs|uninstall'],
  ['token', 'issue a token for an actor: legenda token you | legenda token agent:curator'],
  ['login', 'remember the server and your token: legenda login --url … --token …'],
];

export function usage(): string {
  const all: Array<[string, string]> = [...LOCAL_COMMANDS, ...COMMANDS.map(c => [c.name, c.summary] as [string, string])];
  const width = Math.max(...all.map(([name]) => name.length));
  const line = ([name, summary]: [string, string]) => `  ${name.padEnd(width)}  ${summary}`;
  return [
    'legenda — what to watch or read next',
    '',
    'usage: legenda <command> [options] [--json]',
    '',
    'on this machine:',
    ...LOCAL_COMMANDS.map(line),
    '',
    'against the server:',
    ...COMMANDS.map(c => line([c.name, c.summary])),
    '',
    'options:',
    '  --json         machine-readable output (for agents)',
    '  --dir <path>   the data directory (or LEGENDA_DIR; default ~/.legenda)',
    '  -h, --help     help; "legenda <command> --help" for one command',
    '  -v, --version  the version',
    '',
    'environment: LEGENDA_URL, LEGENDA_TOKEN (else $LEGENDA_DIR/client.json)',
    'Run "legenda agents" for the contract an AI agent should follow.',
  ].join('\n');
}

export interface ServeRequest {
  dbPath: string;
  dataDir: string;
  hostname: string;
  port: number;
  development: boolean;
  out: (line?: string) => void;
}

export interface RunOptions {
  argv: readonly string[];
  out: (line?: string) => void;
  err: (line?: string) => void;
  env?: Record<string, string | undefined>;
  now?: () => string;
  fetch?: Fetch;
  readStdin?: () => Promise<string>;
  /** Injected by tests so `serve` does not block. */
  serve?: (request: ServeRequest) => Promise<number>;
}

interface Globals {
  dir: string | undefined;
  help: boolean;
  version: boolean;
  json: boolean;
  rest: string[];
}

function liftGlobals(argv: readonly string[]): Globals {
  const globals: Globals = {dir: undefined, help: false, version: false, json: false, rest: []};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--') {
      globals.rest.push(...argv.slice(i));
      break;
    }
    if (token === '--dir') {
      globals.dir = argv[++i];
    } else if (token.startsWith('--dir=')) {
      globals.dir = token.slice(6);
    } else if (token === '--help' || token === '-h') {
      globals.help = true;
    } else if (token === '--version' || token === '-v') {
      globals.version = true;
    } else if (token === '--json') {
      globals.json = true;
    } else {
      globals.rest.push(token);
    }
  }
  return globals;
}

export async function run(options: RunOptions): Promise<number> {
  const {out, err} = options;
  const env = options.env ?? process.env;
  const now = options.now ?? nowIso;
  const globals = liftGlobals(options.argv);
  const {json} = globals;

  const emitJson = (body: unknown) => out(JSON.stringify(body, null, 2));
  const fail = (message: string, code: number, extra: Record<string, unknown> = {}, hint?: string): number => {
    if (json) emitJson(failure(message, code, hint === undefined ? extra : {...extra, hint}));
    else {
      err(`legenda: ${message}`);
      if (hint !== undefined) err(hint);
      const candidates = extra['candidates'];
      if (Array.isArray(candidates)) for (const c of candidates) err(`  ${String(c)}`);
    }
    return code;
  };

  if (globals.version) {
    if (json) emitJson({ok: true, version: VERSION});
    else out(VERSION);
    return EXIT_OK;
  }

  const [name, ...rest] = globals.rest;
  if (name === undefined || name === 'help') {
    out(usage());
    return EXIT_OK;
  }

  const dataDir = dataDirFrom(env, globals.dir);

  // --- on this machine ---------------------------------------------------------------

  if (name === 'serve') {
    const args = parseArgs(rest, {boolean: ['dev'], alias: {p: 'port', H: 'host'}});
    const dbPath = join(dataDir, DB_FILE);
    let host = flagValue(args, 'host') ?? env['LEGENDA_HOST'];
    if (host === undefined) {
      const db = openDatabase(dbPath);
      host = getSetting(db, 'listen_host') ?? '0.0.0.0';
      db.close();
    }
    const port = Number(flagValue(args, 'port') ?? env['LEGENDA_PORT'] ?? DEFAULT_PORT);
    if (!Number.isInteger(port)) return fail('--port must be a number', EXIT_USAGE);
    return (options.serve ?? serve)({dbPath, dataDir, hostname: host, port, development: args.booleans.has('dev'), out});
  }

  if (name === 'service') {
    const {serviceCommand} = await import('./local/service.ts');
    return serviceCommand({dataDir, out, err}, rest);
  }

  if (name === 'token') {
    const actor = rest[0];
    if (actor === undefined || globals.help) {
      out('usage: legenda token <actor>    e.g. legenda token you, legenda token agent:curator');
      return actor === undefined && !globals.help ? EXIT_USAGE : EXIT_OK;
    }
    const db = openDatabase(join(dataDir, DB_FILE));
    try {
      const token = createToken(db, actor, now());
      if (json) emitJson({ok: true, actor, token});
      else out(token);
      return EXIT_OK;
    } catch (error) {
      return error instanceof AppError ? fail(error.message, error.code) : fail(describe(error), EXIT_ERROR);
    } finally {
      db.close();
    }
  }

  if (name === 'login') {
    const args = parseArgs(rest);
    const url = flagValue(args, 'url') ?? env['LEGENDA_URL'];
    const token = flagValue(args, 'token') ?? env['LEGENDA_TOKEN'];
    if (url === undefined || token === undefined || globals.help) {
      out('usage: legenda login --url http://127.0.0.1:7778 --token <token>');
      return globals.help ? EXIT_OK : EXIT_USAGE;
    }
    let actor: unknown;
    try {
      const result = await callApi({url: url.replace(/\/+$/, ''), token}, {method: 'GET', path: '/api/whoami'}, options.fetch);
      if (result.body['ok'] !== true) return fail(`the server did not accept that token: ${String(result.body['error'])}`, EXIT_USAGE);
      actor = result.body['actor'];
    } catch (error) {
      if (!(error instanceof Unreachable)) throw error;
      return fail(`cannot reach a legenda server at ${url}: ${error.message}`, EXIT_UNAVAILABLE, {}, 'start it with "legenda serve", then log in again');
    }
    const path = writeClientFile(dataDir, {url, token});
    if (json) emitJson({ok: true, url, actor, path});
    else out(`logged in to ${url} as ${String(actor)} (saved to ${path})`);
    return EXIT_OK;
  }

  // --- against the server ------------------------------------------------------------

  const matched = matchCommand(globals.rest);
  if (matched === undefined) return fail(`unknown command "${name}"; run "legenda --help"`, EXIT_USAGE);
  const {command} = matched;
  if (globals.help) {
    out(command.usage);
    return EXIT_OK;
  }

  const args = parseArgs(matched.rest, {boolean: command.booleans ?? [], alias: command.alias ?? {}});
  const problem = argsProblem(command, args);
  if (problem !== undefined) return fail(`${problem}\nusage: ${command.usage}`, EXIT_USAGE);

  const config = clientConfig(env, dataDir);
  let result;
  try {
    const call = await command.build(args, {
      env,
      readStdin: options.readStdin ?? (() => Bun.stdin.text()),
      call: request => callApi(config, request, options.fetch),
      edit: text => editInEditor(text, env),
    });
    result = await callApi(config, call, options.fetch);
  } catch (error) {
    if (error instanceof CommandUsage) return fail(error.message, EXIT_USAGE);
    if (!(error instanceof Unreachable)) throw error;
    return fail(`cannot reach the legenda server at ${config.url}`, EXIT_UNAVAILABLE, {}, 'start it with "legenda serve" (or check LEGENDA_URL / legenda login)');
  }

  const {body} = result;
  if (result.status === 401) {
    return fail(
      config.token === undefined ? 'no token: this machine has not been given one' : 'the server did not accept this token',
      EXIT_USAGE,
      {},
      'on the server machine run "legenda token you" (or agent:<name>), then "legenda login --url … --token …"',
    );
  }
  if (body['ok'] !== true) {
    const code = typeof body['code'] === 'number' ? body['code'] : EXIT_ERROR;
    if (json) {
      emitJson(body);
      return code;
    }
    const {ok: _ok, error, code: _code, ...extra} = body;
    return fail(String(error), code, extra);
  }
  if (json) emitJson(body);
  else {
    const text = command.human(body, args);
    for (const line of Array.isArray(text) ? text : [text]) out(line);
  }
  return EXIT_OK;
}

function argsProblem(command: CommandDef, args: ParsedArgs): string | undefined {
  if (args.errors.length > 0) return args.errors[0];
  const allowed = new Set([...(command.values ?? [])]);
  for (const flag of args.flags.keys()) {
    if (!allowed.has(flag)) return `unknown option --${flag} for "${command.name}"`;
  }
  return undefined;
}

async function serve(request: ServeRequest): Promise<number> {
  const {startServer} = await import('./server/server.ts');
  const {startBackground} = await import('./server/background.ts');
  const db = openDatabase(request.dbPath);
  const running = startServer({
    db,
    hostname: request.hostname,
    port: request.port,
    development: request.development,
    background: deps => startBackground(deps, {dataDir: request.dataDir, log: line => request.out(line)}),
    log: line => request.out(line),
  });

  request.out(`legenda is serving ${request.dbPath}`);
  request.out(`  on this machine:  http://localhost:${running.server.port}`);
  if (request.hostname === '0.0.0.0') {
    for (const address of lanAddresses()) request.out(`  on your network:  http://${address}:${running.server.port}`);
  }
  await new Promise<void>(resolve => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
  await running.stop();
  db.close();
  return EXIT_OK;
}

async function editInEditor(text: string, env: Record<string, string | undefined>): Promise<string> {
  const editor = env['VISUAL'] || env['EDITOR'] || 'vi';
  const dir = mkdtempSync(join(tmpdir(), 'legenda-edit-'));
  const path = join(dir, 'profile.md');
  writeFileSync(path, text);
  try {
    const proc = Bun.spawn(['sh', '-c', `${editor} "$1"`, 'sh', path], {stdin: 'inherit', stdout: 'inherit', stderr: 'inherit'});
    if ((await proc.exited) !== 0) throw new CommandUsage(`${editor} exited without saving; nothing changed`);
    return readFileSync(path, 'utf8');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

function lanAddresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
  }
  return found;
}

if (import.meta.main) {
  const code = await run({
    argv: process.argv.slice(2),
    out: line => process.stdout.write(`${line ?? ''}\n`),
    err: line => process.stderr.write(`${line ?? ''}\n`),
  });
  process.exit(code);
}
