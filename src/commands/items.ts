import {flagValue} from '../core/args.ts';
import type {Item} from '../core/types.ts';
import {itemLine} from './render.ts';
import {CommandUsage, type CommandDef} from './types.ts';

export const itemCommands: CommandDef[] = [
  {
    name: 'list',
    summary: 'what is on the list (or done, or dismissed)',
    usage: 'legenda list [--source youtube|papers|docs] [--state queue|done|dismissed|all] [--origin follow|agent|you] [--sort newest|oldest] [--limit N]',
    values: ['source', 'state', 'origin', 'sort', 'limit'],
    build: args => ({
      method: 'GET',
      path: '/api/items',
      query: {
        source: flagValue(args, 'source'),
        state: flagValue(args, 'state'),
        origin: flagValue(args, 'origin'),
        sort: flagValue(args, 'sort'),
        limit: flagValue(args, 'limit'),
      },
    }),
    human: body => {
      const items = body['items'] as Item[];
      return items.length === 0 ? 'nothing here' : items.map(itemLine);
    },
  },
  {
    name: 'show',
    summary: 'one item, in full',
    usage: 'legenda show <item>',
    build: args => {
      const ref = args.positional[0];
      if (ref === undefined) throw new CommandUsage('which item? legenda show <id or url>');
      return {method: 'GET', path: `/api/items/${encodeURIComponent(ref)}`};
    },
    human: body => {
      const item = body['item'] as Item;
      const lines = [itemLine(item), `  ${item.url}`];
      if (item.reason !== null) lines.push(`  why: ${item.reason}`);
      if (item.summary !== null) lines.push(`  summary: ${item.summary}`);
      if (item.abstract !== null) lines.push(`  abstract: ${item.abstract}`);
      return lines;
    },
  },
  {
    name: 'add',
    summary: 'add videos, papers or docs by URL',
    usage: 'legenda add <url…> [--source youtube|papers|docs]',
    values: ['source'],
    build: args => {
      if (args.positional.length === 0) throw new CommandUsage('usage: legenda add <url…>');
      return {method: 'POST', path: '/api/items', body: {refs: args.positional, source: flagValue(args, 'source')}};
    },
    human: body =>
      (body['results'] as Array<{ref: string; ok: boolean; existing?: boolean; item?: Item; error?: string}>).map(r =>
        r.ok ? `${r.existing === true ? 'already known' : 'added'}: ${itemLine(r.item!)}` : `failed: ${r.ref}: ${r.error}`,
      ),
  },
];

