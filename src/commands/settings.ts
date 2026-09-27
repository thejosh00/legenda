import type {SettingJson} from '../db/settings.ts';
import {table} from './render.ts';
import {CommandUsage, type CommandDef} from './types.ts';

const show = (s: SettingJson) => [s.key, s.value ?? '(unset)', s.is_set ? '' : '(default)', s.summary];

export const settingsCommands: CommandDef[] = [
  {
    name: 'settings',
    summary: "this instance's settings (keys are never shown)",
    usage: 'legenda settings',
    build: () => ({method: 'GET', path: '/api/settings'}),
    human: body => table((body['settings'] as SettingJson[]).map(show)),
  },
  {
    name: 'settings get',
    summary: 'one setting',
    usage: 'legenda settings get <key>',
    build: args => {
      if (args.positional[0] === undefined) throw new CommandUsage('usage: legenda settings get <key>');
      return {method: 'GET', path: `/api/settings/${encodeURIComponent(args.positional[0])}`};
    },
    human: body => (body['setting'] as SettingJson).value ?? '(unset)',
  },
  {
    name: 'settings set',
    summary: 'change a setting',
    usage: 'legenda settings set <key> <value>',
    build: args => {
      const [key, ...value] = args.positional;
      if (key === undefined || value.length === 0) throw new CommandUsage('usage: legenda settings set <key> <value>  (legenda settings unset <key> to clear)');
      return {method: 'PUT', path: `/api/settings/${encodeURIComponent(key)}`, body: {value: value.join(' ')}};
    },
    human: body => {
      const s = body['setting'] as SettingJson;
      return `${s.key} = ${s.value ?? '(unset)'}`;
    },
  },
  {
    name: 'settings unset',
    summary: 'clear a setting back to its default',
    usage: 'legenda settings unset <key>',
    build: args => {
      if (args.positional[0] === undefined) throw new CommandUsage('usage: legenda settings unset <key>');
      return {method: 'PUT', path: `/api/settings/${encodeURIComponent(args.positional[0])}`, body: {value: null}};
    },
    human: body => {
      const s = body['setting'] as SettingJson;
      return `${s.key} = ${s.value ?? '(unset)'} (default)`;
    },
  },
];
