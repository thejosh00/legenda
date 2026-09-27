import {curatorCommands} from './curator.ts';
import {followCommands} from './follows.ts';
import {itemCommands} from './items.ts';
import {pollCommands} from './poll.ts';
import {settingsCommands} from './settings.ts';
import {stateCommands} from './state.ts';
import {tasteCommands} from './taste.ts';
import type {CommandDef} from './types.ts';

export const COMMANDS: CommandDef[] = [...itemCommands, ...stateCommands, ...followCommands, ...tasteCommands, ...pollCommands, ...curatorCommands, ...settingsCommands];

/** The command named by the leading words of argv, longest name first. */
export function matchCommand(argv: readonly string[]): {command: CommandDef; rest: string[]} | undefined {
  const sorted = [...COMMANDS].sort((a, b) => b.name.split(' ').length - a.name.split(' ').length);
  for (const command of sorted) {
    const words = command.name.split(' ');
    if (words.every((word, i) => argv[i] === word)) return {command, rest: argv.slice(words.length)};
  }
  return undefined;
}
