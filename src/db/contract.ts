import {agentsDocument, type ContractOptions} from '../core/agentsDoc.ts';
import {VERSION} from '../version.ts';
import type {Ctx} from './context.ts';
import {getSetting, numberSetting} from './settings.ts';

export function contractOptions(ctx: Ctx): ContractOptions {
  const n = (key: string) => numberSetting(ctx.db, key);
  return {
    version: VERSION,
    sources: ctx.sources.list().map(s => s.id),
    limits: {
      daily_suggestion_cap: n('daily_suggestion_cap'),
      daily_follow_intake_cap: n('daily_follow_intake_cap'),
      max_per_creator_per_run: n('max_per_creator_per_run'),
      summary_max_chars: n('summary_max_chars'),
      profile_max_bytes: n('profile_max_bytes'),
    },
    ...(ctx.sources.isEnabled('docs')
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

export const contractDocument = (ctx: Ctx) => agentsDocument(contractOptions(ctx));
