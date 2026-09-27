/**
 * The web app's view of the server: the same JSON API the CLI uses, signed in by a
 * session cookie.
 */
import type {Follow, Item} from '../core/types.ts';

export type {Follow, Item};

export interface SourceInfo {
  id: 'youtube' | 'papers' | 'docs';
  name: string;
  done_label: 'Watched' | 'Read';
  item_label: string;
  fetched_by: 'app' | 'agent';
  follow_kinds: string[];
}

export interface WhoAmI {
  actor: string;
  version: string;
  enabled_sources: string[];
  sources: SourceInfo[];
  docs?: {label: string; item_label: string; reauth_hint: string | null};
}

export interface FeedbackEntry {
  kind: string;
  note: string;
  at: string;
}

export type ItemWithFeedback = Item & {feedback?: FeedbackEntry[]};

export interface Interest {
  id: string;
  topic: string;
  strength: 'core' | 'curious' | 'avoid';
  sources: string[];
  note: string;
  added: string;
}

export interface ProfileVersion {
  version: number;
  body: string;
  actor: string;
  note: string;
  at: string;
}

export interface Run {
  id: string;
  actor: string;
  started: string;
  finished: string | null;
  outcome: 'ok' | 'partial' | 'needs_auth' | 'failed' | null;
  queries: unknown;
  considered: number;
  suggested: number;
  from_follows: number;
  summary: string;
  items: Item[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : {'content-type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  let parsed: Record<string, unknown>;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError(`the server answered ${response.status}`, 1, response.status, {});
  }
  if (parsed['ok'] !== true) {
    throw new ApiError(String(parsed['error'] ?? 'something went wrong'), Number(parsed['code'] ?? 1), response.status, parsed);
  }
  return parsed as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});

export const itemPath = (id: string, action?: string) => `/api/items/${encodeURIComponent(id)}${action === undefined ? '' : `/${action}`}`;
