import {flagValue, hasFlag, type ParsedArgs} from '../core/args.ts';
import type {Follow} from '../core/types.ts';
import {table} from './render.ts';
import {CommandUsage, type CommandDef} from './types.ts';

const followLine = (f: Follow) => `${f.id}  ${f.source}  ${f.kind}  ${f.title}${f.status === 'blocked' ? '  [blocked]' : ''}${f.screened ? '  [screened]' : ''}`;

function screened(args: ParsedArgs): boolean | undefined {
  if (hasFlag(args, 'screened')) return true;
  if (hasFlag(args, 'unscreened')) return false;
  return undefined;
}

const followPath = (ref: string | undefined, suffix = '') => {
  if (ref === undefined) throw new CommandUsage('which follow? give its id (see "legenda follows")');
  return `/api/follows/${encodeURIComponent(ref)}${suffix}`;
};

export const followCommands: CommandDef[] = [
  {
    name: 'follows',
    summary: 'what you follow and block',
    usage: 'legenda follows [--source …] [--status following|blocked]',
    values: ['source', 'status'],
    build: args => ({method: 'GET', path: '/api/follows', query: {source: flagValue(args, 'source'), status: flagValue(args, 'status')}}),
    human: body => {
      const follows = body['follows'] as Follow[];
      if (follows.length === 0) return 'not following anything yet';
      return table(
        follows.map(f => [
          f.id,
          f.source,
          f.kind,
          f.title,
          [f.status === 'blocked' ? 'blocked' : '', f.screened ? 'screened' : '', f.last_error ? `error: ${f.last_error}` : '', f.note ? `“${f.note}”` : ''].filter(Boolean).join('  '),
        ]),
      );
    },
  },
  {
    name: 'follow',
    summary: 'follow a channel, author, category, collection, tag or query',
    usage: 'legenda follow <source> <url|handle|id|category|collection|tag|query> [--kind …] [--note "…"] [--screened|--unscreened] [--title "…"]',
    values: ['kind', 'note', 'title'],
    booleans: ['screened', 'unscreened'],
    build: args => {
      const [source, ...rest] = args.positional;
      if (source === undefined || rest.length === 0) throw new CommandUsage('usage: legenda follow <source> <what>');
      return {
        method: 'POST',
        path: '/api/follows',
        body: {source, ref: rest.join(' '), kind: flagValue(args, 'kind'), note: flagValue(args, 'note'), title: flagValue(args, 'title'), screened: screened(args)},
      };
    },
    human: body => `${body['existing'] === true ? 'already following' : 'following'}: ${followLine(body['follow'] as Follow)}`,
  },
  {
    name: 'follow set',
    summary: "change a follow's note (its screening rule) or screening",
    usage: 'legenda follow set <follow> [--note "…"] [--screened|--unscreened] [--title "…"]',
    values: ['note', 'title'],
    booleans: ['screened', 'unscreened'],
    build: args => ({method: 'PATCH', path: followPath(args.positional[0]), body: {note: flagValue(args, 'note'), title: flagValue(args, 'title'), screened: screened(args)}}),
    human: body => `updated: ${followLine(body['follow'] as Follow)}`,
  },
  {
    name: 'follow cursor',
    summary: "(agent) move an agent-fed follow's cursor",
    usage: 'legenda follow cursor <follow> <value>',
    build: args => {
      const [ref, value] = args.positional;
      if (value === undefined) throw new CommandUsage('usage: legenda follow cursor <follow> <value>');
      return {method: 'POST', path: followPath(ref, '/cursor'), body: {value}};
    },
    human: body => `cursor now ${(body['follow'] as Follow).cursor}`,
  },
  {
    name: 'unfollow',
    summary: 'stop following',
    usage: 'legenda unfollow <follow>',
    build: args => ({method: 'DELETE', path: followPath(args.positional[0])}),
    human: body => `unfollowed ${(body['follow'] as Follow).title}`,
  },
  {
    name: 'block',
    summary: 'block a follow, or the creator of an item',
    usage: 'legenda block <follow-or-item>',
    build: args => {
      if (args.positional[0] === undefined) throw new CommandUsage('usage: legenda block <follow-or-item>');
      return {method: 'POST', path: '/api/block', body: {ref: args.positional[0]}};
    },
    human: body => `blocked: ${followLine(body['follow'] as Follow)}`,
  },
  {
    name: 'unblock',
    summary: 'remove a block',
    usage: 'legenda unblock <follow>',
    build: args => ({method: 'POST', path: followPath(args.positional[0], '/unblock')}),
    human: body => `unblocked ${(body['follow'] as Follow).title}`,
  },
];
