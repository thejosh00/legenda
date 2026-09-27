import {flagValue} from '../core/args.ts';
import type {PollResult} from '../db/poll.ts';
import type {CommandDef} from './types.ts';

export const pollCommands: CommandDef[] = [
  {
    name: 'poll',
    summary: 'check followed channels and feeds now',
    usage: 'legenda poll [--follow <id>]',
    values: ['follow'],
    build: args => ({method: 'POST', path: '/api/poll', body: {follow: flagValue(args, 'follow')}}),
    human: body => {
      const results = body['results'] as PollResult[];
      if (results.length === 0) return 'nothing to poll';
      return results.map(r => `${r.title}: ${r.error !== null ? `error: ${r.error}` : `${r.added} added${r.offered > 0 ? `, ${r.offered} for screening` : ''}${r.skipped > 0 ? `, ${r.skipped} skipped` : ''}`}`);
    },
  },
];
