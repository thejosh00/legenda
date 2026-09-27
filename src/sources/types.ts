/**
 * The one interface every source implements, as much of it as it supports.
 *
 * Everything that talks to the network goes through the injected `Fetcher`, so tests
 * hand in fixtures and never reach the internet. Parsing lives in `src/core/`.
 */
import type {Follow, FollowCandidate, ItemInput, SourceId} from '../core/types.ts';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface SearchOpts {
  max?: number;
  publishedAfter?: string;
  duration?: 'short' | 'medium' | 'long';
  yearFrom?: number;
}

export interface SourceDeps {
  fetcher: Fetcher;
  /** A setting's current value (secrets included: sources need their keys). */
  setting(key: string): string | undefined;
  /** Record quota spent today; throws an AppError if it would pass the daily ceiling. */
  spend(units: number): void;
  now(): string;
  /** Wait for a turn at a rate-limited API, shared across the whole server. */
  gate(name: string, intervalMs: number): Promise<void>;
}

export interface Source {
  id: SourceId;
  label: {done: 'Watched' | 'Read'; item: string; name: string};
  followKinds: readonly string[];
  fetchedBy: 'app' | 'agent';

  // App-fetched sources only.
  resolveFollow?(input: string, kind?: string): Promise<FollowCandidate>;
  poll?(follow: Follow, since: string | null): Promise<ItemInput[]>;
  search?(query: string, opts: SearchOpts): Promise<ItemInput[]>;
  details?(refs: string[]): Promise<ItemInput[]>;
  recommend?(positive: string[], negative: string[], max: number): Promise<ItemInput[]>;

  // All sources.
  /** A URL (or, where unambiguous, a bare id) → the id used for dedup, or null if not ours. */
  parseRef(input: string): {externalId: string} | null;
  /** The canonical URL for an id, when the source can build one. */
  canonicalUrl?(externalId: string): string;
  /** Agent-fed sources: what is missing or wrong with a submitted item, or null. */
  validateAgentItem?(item: ItemInput): string | null;
}
