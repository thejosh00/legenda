/**
 * `legenda context`: everything one curator run needs, in one call, for enabled
 * sources only.
 */
import type {Ctx} from './context.ts';
import {quotaLeft} from './context.ts';
import {suggestionCaps} from './curator.ts';
import {feedbackSince} from './feedback.ts';
import {listFollows} from './follows.ts';
import {followIntakeToday, pendingIntakeCount} from './intake.ts';
import {listItems} from './items.ts';
import {openRunOf, recentRuns, since90Days} from './runs.ts';
import {getSetting, numberSetting} from './settings.ts';
import {latestProfile, listInterests} from './taste.ts';

export function agentContext(ctx: Ctx): Record<string, unknown> {
  const since = since90Days(ctx);
  const enabled = ctx.sources.enabled;
  const followCap = numberSetting(ctx.db, 'daily_follow_intake_cap');
  const followUsed = followIntakeToday(ctx);

  const quota: Record<string, unknown> = {};
  for (const source of ctx.sources.list()) {
    if (source.id === 'youtube') {
      quota['youtube'] = {units_left: quotaLeft(ctx, 'youtube'), has_key: getSetting(ctx.db, 'youtube_api_key') !== undefined};
    } else if (source.id === 'papers') {
      quota['papers'] = {units_left: null, has_key: getSetting(ctx.db, 'semantic_scholar_api_key') !== undefined};
    }
  }

  const profile = latestProfile(ctx);
  const open = openRunOf(ctx);
  return {
    now: ctx.now(),
    actor: ctx.actor,
    enabled_sources: enabled,
    sources: ctx.sources.list().map(s => ({id: s.id, name: s.label.name, item_label: s.label.item, fetched_by: s.fetchedBy, follow_kinds: s.followKinds})),
    profile: profile === null ? null : {version: profile.version, body: profile.body, actor: profile.actor, at: profile.at, note: profile.note},
    interests: listInterests(ctx).filter(i => i.sources.length === 0 || i.sources.some(s => enabled.includes(s))),
    follows: listFollows(ctx).map(f => ({
      id: f.id,
      source: f.source,
      kind: f.kind,
      external_id: f.external_id,
      title: f.title,
      status: f.status,
      note: f.note,
      fetched_by: f.fetched_by,
      screened: f.screened,
      cursor: f.cursor,
      last_checked: f.last_checked,
    })),
    feedback: feedbackSince(ctx, since).filter(f => f.item === null || enabled.includes(f.item.source as never)),
    recent_items: listItems(ctx, {state: 'all', since}).map(i => ({
      id: i.id,
      source: i.source,
      external_id: i.external_id,
      title: i.title,
      creator: i.creator,
      origin: i.origin,
      state: i.state,
    })),
    caps: {
      suggestions: suggestionCaps(ctx),
      follow_intake: {cap: followCap, used: followUsed, left: Math.max(0, followCap - followUsed)},
      max_per_creator_per_run: numberSetting(ctx.db, 'max_per_creator_per_run'),
      summary_max_chars: numberSetting(ctx.db, 'summary_max_chars'),
      profile_max_bytes: numberSetting(ctx.db, 'profile_max_bytes'),
    },
    quota,
    intake_pending: pendingIntakeCount(ctx),
    needs_enrichment: listItems(ctx, {state: 'queue'})
      .filter(i => i.source === 'docs' && (i.title === '' || i.summary === null))
      .map(i => ({id: i.id, source: i.source, external_id: i.external_id, url: i.url, title: i.title})),
    recent_runs: recentRuns(ctx, 3),
    open_run: open === undefined ? null : {id: open.id, started: open.started},
    ...(enabled.includes('docs')
      ? {
          docs: {
            label: getSetting(ctx.db, 'docs_label') ?? 'Docs',
            item_label: getSetting(ctx.db, 'docs_item_label') ?? 'page',
            base_url: getSetting(ctx.db, 'docs_base_url') ?? null,
            query_hint: getSetting(ctx.db, 'docs_query_hint') ?? null,
            reauth_hint: getSetting(ctx.db, 'docs_reauth_hint') ?? null,
          },
        }
      : {}),
  };
}
