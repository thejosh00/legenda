/**
 * An organisation's internal docs, fed by the agent.
 *
 * The app never talks to the docs system and holds no credentials for it: the agent reads
 * it with its own read-only tools and hands legenda what it found. So this adapter has no
 * network code at all — it recognises page links and checks what the agent submits.
 */
import {docPageId, underBase} from '../core/docs.ts';
import type {ItemInput} from '../core/types.ts';
import type {Source, SourceDeps} from './types.ts';

export function docsSource(deps: SourceDeps): Source {
  const base = () => deps.setting('docs_base_url');
  return {
    id: 'docs',
    label: {done: 'Read', item: deps.setting('docs_item_label') ?? 'page', name: deps.setting('docs_label') ?? 'Docs'},
    followKinds: ['collection', 'tag', 'author', 'query'],
    fetchedBy: 'agent',

    parseRef(input) {
      if (!underBase(input, base())) return null;
      const id = docPageId(input);
      return id === undefined ? null : {externalId: id};
    },

    validateAgentItem(item: ItemInput) {
      const missing = (['external_id', 'url', 'title', 'summary'] as const).filter(key => typeof item[key] !== 'string' || item[key]!.trim() === '');
      if (missing.length > 0) return `a ${deps.setting('docs_item_label') ?? 'page'} needs ${missing.join(', ')}`;
      const root = base();
      if (root === undefined) return 'docs_base_url is not set on this instance; the user must set it before any doc is accepted';
      if (!underBase(item.url, root)) return `the URL must start with docs_base_url (${root}); got ${item.url}`;
      const max = Number(deps.setting('summary_max_chars') ?? 400);
      if (item.summary!.trim().length > max) return `the summary is ${item.summary!.trim().length} characters; keep it to ${max} (summary_max_chars)`;
      if (item.length_minutes !== undefined && item.length_minutes !== null && (!Number.isInteger(item.length_minutes) || item.length_minutes < 0)) {
        return 'length_minutes must be a whole number';
      }
      return null;
    },
  };
}
