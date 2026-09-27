/**
 * Every setting an instance has, its default, and how to check a new value.
 *
 * Settings live in the instance's database, which is what keeps anything specific to
 * one organisation out of the repo. Secrets are stored but never returned.
 */
import {SOURCE_IDS, isSourceId, type SourceId} from './types.ts';

export interface SettingSpec {
  default: string | undefined;
  secret?: boolean;
  summary: string;
  /** An error message, or undefined if the value is fine. Values arrive trimmed. */
  validate?: (value: string) => string | undefined;
}

const integer = (min: number) => (value: string) =>
  /^\d+$/.test(value) && Number(value) >= min ? undefined : `must be a whole number ≥ ${min}`;
const boolean = (value: string) => (value === 'true' || value === 'false' ? undefined : 'must be true or false');
const url = (value: string) => (/^https?:\/\/[^\s]+$/.test(value) ? undefined : 'must be an http(s) URL');

export const SETTINGS: Record<string, SettingSpec> = {
  enabled_sources: {
    default: 'youtube,papers',
    summary: 'comma-separated sources this instance uses: youtube, papers, docs',
    validate: value => {
      const bad = value.split(',').map(s => s.trim()).filter(s => s !== '' && !isSourceId(s));
      return bad.length > 0 ? `unknown source ${bad.join(', ')}; choose from ${SOURCE_IDS.join(', ')}` : undefined;
    },
  },
  listen_host: {
    default: '0.0.0.0',
    summary: 'where `legenda serve` listens: 0.0.0.0 (your network) or 127.0.0.1 (this machine)',
  },
  daily_suggestion_cap: {default: '5', summary: "agent suggestions per local day, all sources", validate: integer(0)},
  daily_follow_intake_cap: {default: '25', summary: 'agent-added follow items per day (screened + docs)', validate: integer(0)},
  max_per_creator_per_run: {default: '2', summary: 'suggestions from one creator within one run', validate: integer(1)},
  youtube_api_key: {default: undefined, secret: true, summary: 'YouTube Data API v3 key (optional)'},
  youtube_daily_units: {default: '3000', summary: 'YouTube API units the app may spend per day', validate: integer(0)},
  youtube_backfill: {default: '3', summary: 'videos taken when a channel is first followed', validate: integer(0)},
  skip_shorts: {default: 'true', summary: 'drop videos of 60 s or less from follow intake', validate: boolean},
  semantic_scholar_api_key: {default: undefined, secret: true, summary: 'Semantic Scholar API key (optional)'},
  papers_backfill: {default: '3', summary: 'papers taken when something is first followed', validate: integer(0)},
  papers_min_year: {default: undefined, summary: 'earliest year for query follows (default: five years back)', validate: integer(1900)},
  profile_max_bytes: {default: '8192', summary: 'cap on the taste profile', validate: integer(256)},
  summary_max_chars: {default: '400', summary: 'cap on an agent summary', validate: integer(40)},
  docs_label: {default: 'Docs', summary: 'what the docs system is called, e.g. Confluence'},
  docs_item_label: {default: 'page', summary: 'what one doc is called'},
  docs_base_url: {default: undefined, summary: 'required for docs: submitted URLs must start with it', validate: url},
  docs_query_hint: {default: undefined, summary: 'the syntax docs `query` follows use, e.g. CQL'},
  docs_reauth_hint: {default: undefined, summary: "how the user renews the agent's docs access"},
};

/** Per-source caps are the one family of keys not listed above: `daily_suggestion_cap.<source>`. */
export function settingSpec(key: string): SettingSpec | undefined {
  const perSource = /^daily_suggestion_cap\.(.+)$/.exec(key);
  if (perSource !== null) {
    if (!isSourceId(perSource[1])) return undefined;
    return {default: undefined, summary: `suggestions per day from ${perSource[1]}`, validate: integer(0)};
  }
  return Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : undefined;
}

export function parseEnabledSources(value: string | undefined): SourceId[] {
  const chosen = (value ?? '').split(',').map(s => s.trim()).filter(isSourceId);
  return SOURCE_IDS.filter(id => chosen.includes(id));
}

export const REDACTED = '(set; hidden)';
