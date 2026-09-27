import {flagValue, hasFlag} from '../core/args.ts';
import type {Item} from '../core/types.ts';
import {itemLine} from './render.ts';
import {CommandUsage, type CommandDef} from './types.ts';

const itemPath = (ref: string | undefined, action: string, usage: string) => {
  if (ref === undefined) throw new CommandUsage(`which item? ${usage}`);
  return `/api/items/${encodeURIComponent(ref)}/${action}`;
};

const outcome = (verb: string) => (body: Record<string, unknown>) => {
  const lines = [`${verb}: ${itemLine(body['item'] as Item)}`];
  for (const f of (body['feedback'] as Array<{kind: string; note: string}> | undefined) ?? []) lines.push(`  noted: ${f.kind}${f.note ? ` — ${f.note}` : ''}`);
  if (typeof body['blocked'] === 'string') lines.push(`  blocked the creator (${body['blocked']})`);
  return lines;
};

export const stateCommands: CommandDef[] = [
  {
    name: 'done',
    summary: 'mark watched/read, with an optional reaction',
    usage: 'legenda done <item> [--reaction loved|liked|meh|disliked|abandoned] [--note "…"]',
    values: ['reaction', 'note'],
    alias: {r: 'reaction', n: 'note'},
    build: args => ({method: 'POST', path: itemPath(args.positional[0], 'done', 'legenda done <item>'), body: {reaction: flagValue(args, 'reaction'), note: flagValue(args, 'note')}}),
    human: outcome('done'),
  },
  {
    name: 'dismiss',
    summary: 'decide not to, with an optional reason',
    usage: 'legenda dismiss <item> [--reason <kind>] [--note "…"] [--block]',
    values: ['reason', 'note'],
    booleans: ['block'],
    alias: {r: 'reason', n: 'note'},
    build: args => ({
      method: 'POST',
      path: itemPath(args.positional[0], 'dismiss', 'legenda dismiss <item>'),
      body: {reason: flagValue(args, 'reason'), note: flagValue(args, 'note'), block: hasFlag(args, 'block')},
    }),
    human: outcome('dismissed'),
  },
  {
    name: 'restore',
    summary: 'put a done or dismissed item back on the list',
    usage: 'legenda restore <item>',
    build: args => ({method: 'POST', path: itemPath(args.positional[0], 'restore', 'legenda restore <item>')}),
    human: outcome('restored'),
  },
  {
    name: 'feedback',
    summary: 'more or less like this, or a comment, on any item',
    usage: 'legenda feedback <item> more|less|comment [--note "…"]',
    values: ['note'],
    alias: {n: 'note'},
    build: args => {
      const [ref, kind] = args.positional;
      if (kind === undefined) throw new CommandUsage('usage: legenda feedback <item> more|less|comment [--note "…"]');
      return {method: 'POST', path: itemPath(ref, 'feedback', ''), body: {kind, note: flagValue(args, 'note')}};
    },
    human: body => {
      const f = body['feedback'] as {kind: string; note: string};
      return `noted ${f.kind}${f.note ? ` — ${f.note}` : ''} on ${itemLine(body['item'] as Item)}`;
    },
  },
];
