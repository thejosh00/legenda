import {flagList, flagValue, hasFlag} from '../core/args.ts';
import type {Interest, ProfileVersion} from '../db/taste.ts';
import {table} from './render.ts';
import {CommandUsage, type CommandDef} from './types.ts';

const profileText = (body: Record<string, unknown>) => {
  const history = body['history'] as ProfileVersion[] | undefined;
  if (history !== undefined) {
    return history.length === 0 ? 'no profile yet' : history.map(v => `v${v.version}  ${v.at}  ${v.actor}${v.note ? `  — ${v.note}` : ''}`);
  }
  const profile = body['profile'] as ProfileVersion | null;
  if (profile === null) return 'no profile yet';
  return [`v${profile.version} by ${profile.actor} at ${profile.at}${profile.note ? ` — ${profile.note}` : ''}`, '', profile.body.trimEnd()];
};

export const tasteCommands: CommandDef[] = [
  {
    name: 'interests',
    summary: 'the topics you care about',
    usage: 'legenda interests',
    build: () => ({method: 'GET', path: '/api/interests'}),
    human: body => {
      const interests = body['interests'] as Interest[];
      if (interests.length === 0) return 'no interests yet: legenda interest add "<topic>" --strength core|curious|avoid';
      return table(interests.map(i => [i.id, i.strength, i.topic, i.sources.length > 0 ? i.sources.join(',') : 'all sources', i.note]));
    },
  },
  {
    name: 'interest add',
    summary: 'add a topic you care about (or want avoided)',
    usage: 'legenda interest add "<topic>" --strength core|curious|avoid [--source youtube,papers] [--note "…"]',
    values: ['strength', 'source', 'note'],
    alias: {s: 'strength'},
    build: args => {
      const topic = args.positional.join(' ').trim();
      if (topic === '') throw new CommandUsage('usage: legenda interest add "<topic>" --strength core|curious|avoid');
      return {method: 'POST', path: '/api/interests', body: {topic, strength: flagValue(args, 'strength') ?? 'core', sources: flagList(args, 'source'), note: flagValue(args, 'note')}};
    },
    human: body => {
      const i = body['interest'] as Interest;
      return `added ${i.strength}: ${i.topic} (${i.id})`;
    },
  },
  {
    name: 'interest rm',
    summary: 'remove an interest',
    usage: 'legenda interest rm <id-or-topic>',
    build: args => {
      const ref = args.positional.join(' ').trim();
      if (ref === '') throw new CommandUsage('usage: legenda interest rm <id-or-topic>');
      return {method: 'DELETE', path: `/api/interests/${encodeURIComponent(ref)}`};
    },
    human: body => `removed: ${(body['interest'] as Interest).topic}`,
  },
  {
    name: 'profile',
    summary: "the curator's summary of your taste",
    usage: 'legenda profile [--history]',
    booleans: ['history'],
    build: args => ({method: 'GET', path: '/api/profile', query: {history: hasFlag(args, 'history') ? 'true' : undefined}}),
    human: profileText,
  },
  {
    name: 'profile edit',
    summary: 'edit the profile in $EDITOR (or --stdin)',
    usage: 'legenda profile edit [--stdin] [--note "…"]',
    values: ['note'],
    booleans: ['stdin'],
    build: async (args, io) => {
      let body: string;
      if (hasFlag(args, 'stdin')) body = await io.readStdin();
      else {
        const current = await io.call({method: 'GET', path: '/api/profile'});
        const profile = current.body['profile'] as ProfileVersion | null;
        body = await io.edit(profile?.body ?? '');
      }
      return {method: 'PUT', path: '/api/profile', body: {body, note: flagValue(args, 'note') ?? 'edited by hand'}};
    },
    human: body => (body['changed'] === true ? `saved as v${(body['profile'] as ProfileVersion).version}` : 'no change'),
  },
  {
    name: 'profile set',
    summary: '(agent) replace the profile from stdin, saying why',
    usage: 'legenda profile set --stdin --note "<what changed and why>"',
    values: ['note'],
    booleans: ['stdin'],
    build: async (args, io) => {
      if (!hasFlag(args, 'stdin')) throw new CommandUsage('profile set reads the new profile from stdin: --stdin');
      return {method: 'PUT', path: '/api/profile', body: {body: await io.readStdin(), note: flagValue(args, 'note') ?? ''}};
    },
    human: body => (body['changed'] === true ? `saved as v${(body['profile'] as ProfileVersion).version}` : 'no change'),
  },
];
