/**
 * The shapes the app stores and the JSON it speaks.
 *
 * Field names are snake_case everywhere — in the database, in JSON, and here — so the
 * contract an agent reads is the schema it is stored in. Unset optional fields are
 * `null` in JSON, never absent, so an agent can rely on every key being there.
 */

export const SOURCE_IDS = ['youtube', 'papers', 'docs'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];
export const isSourceId = (value: unknown): value is SourceId => SOURCE_IDS.includes(value as SourceId);

export const ITEM_STATES = ['queue', 'done', 'dismissed'] as const;
export type ItemState = (typeof ITEM_STATES)[number];
export const isItemState = (value: unknown): value is ItemState => ITEM_STATES.includes(value as ItemState);

export const ORIGINS = ['follow', 'agent', 'you'] as const;
export type Origin = (typeof ORIGINS)[number];
export const isOrigin = (value: unknown): value is Origin => ORIGINS.includes(value as Origin);

/** `you`, or `agent:<name>`. */
export type Actor = string;
export const USER_ACTOR = 'you';
const ACTOR_PATTERN = /^(you|agent:[a-z0-9][a-z0-9_-]{0,39})$/;
export const isActor = (value: string): boolean => ACTOR_PATTERN.test(value);
export const isAgent = (actor: Actor): boolean => actor.startsWith('agent:');

/** What a source hands the app, or an agent submits: everything but the app's bookkeeping. */
export interface ItemInput {
  source: SourceId;
  external_id: string;
  url: string;
  title: string;
  creator: string;
  creator_external_id?: string | null;
  container?: string | null;
  published?: string | null;
  length_minutes?: number | null;
  thumbnail?: string | null;
  abstract?: string | null;
  summary?: string | null;
  extra?: Record<string, unknown>;
}

export interface Item {
  id: string;
  source: SourceId;
  external_id: string;
  url: string;
  title: string;
  creator: string;
  creator_external_id: string | null;
  container: string | null;
  published: string | null;
  length_minutes: number | null;
  thumbnail: string | null;
  abstract: string | null;
  summary: string | null;
  extra: Record<string, unknown>;
  origin: Origin;
  follow_id: string | null;
  added_by: Actor;
  reason: string | null;
  state: ItemState;
  added: string;
  changed: string;
  version: number;
  run_id: string | null;
}

export const FOLLOW_STATUSES = ['following', 'blocked'] as const;
export type FollowStatus = (typeof FOLLOW_STATUSES)[number];

export interface Follow {
  id: string;
  source: SourceId;
  kind: string;
  external_id: string;
  title: string;
  url: string | null;
  status: FollowStatus;
  note: string;
  fetched_by: 'app' | 'agent';
  screened: boolean;
  cursor: string | null;
  added: string;
  last_checked: string | null;
  last_error: string | null;
}

/** A follow a source has resolved from what the user pasted, before it is stored. */
export interface FollowCandidate {
  kind: string;
  external_id: string;
  title: string;
  url: string | null;
}
