/**
 * Talking to `legenda serve` from the command line.
 *
 * Where the server is and who you are come from `LEGENDA_URL` / `LEGENDA_TOKEN`, then
 * from `$LEGENDA_DIR/client.json` (written by `legenda login`), then defaults. The file
 * matters: the curator runs unattended, where no shell profile sets the environment.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DEFAULT_PORT} from './config.ts';

export const CLIENT_FILE = 'client.json';
export const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

export interface ClientConfig {
  url: string;
  token: string | undefined;
}

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

function readClientFile(dataDir: string): Partial<ClientConfig> {
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, CLIENT_FILE), 'utf8')) as Record<string, unknown>;
    return {
      ...(typeof parsed['url'] === 'string' ? {url: parsed['url']} : {}),
      ...(typeof parsed['token'] === 'string' ? {token: parsed['token']} : {}),
    };
  } catch {
    return {};
  }
}

export function clientConfig(env: Record<string, string | undefined>, dataDir: string): ClientConfig {
  const file = readClientFile(dataDir);
  const url = (env['LEGENDA_URL']?.trim() || file.url?.trim() || DEFAULT_URL).replace(/\/+$/, '');
  const token = env['LEGENDA_TOKEN']?.trim() || file.token?.trim() || undefined;
  return {url, token};
}

export function writeClientFile(dataDir: string, config: {url: string; token: string}): string {
  mkdirSync(dataDir, {recursive: true});
  const path = join(dataDir, CLIENT_FILE);
  writeFileSync(path, `${JSON.stringify({url: config.url.replace(/\/+$/, ''), token: config.token}, null, 2)}\n`, {mode: 0o600});
  return path;
}

export class Unreachable extends Error {}

export interface ApiCall {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

/** Call the server. Throws `Unreachable` if it cannot be reached or does not answer in JSON. */
export async function callApi(config: ClientConfig, call: ApiCall, fetcher: Fetch = fetch): Promise<ApiResult> {
  const url = new URL(`${config.url}${call.path}`);
  for (const [key, value] of Object.entries(call.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {accept: 'application/json'};
  if (call.body !== undefined) headers['content-type'] = 'application/json';
  if (config.token !== undefined) headers['authorization'] = `Bearer ${config.token}`;

  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method: call.method,
      headers,
      ...(call.body === undefined ? {} : {body: JSON.stringify(call.body)}),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new Unreachable(error instanceof Error ? error.message : String(error));
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Unreachable(`the server at ${config.url} answered ${response.status} without JSON — is that a legenda server?`);
  }
  if (typeof body !== 'object' || body === null || typeof (body as {ok?: unknown}).ok !== 'boolean') {
    throw new Unreachable(`unexpected ${response.status} from the server`);
  }
  return {status: response.status, body: body as Record<string, unknown>};
}
