/**
 * A legenda instance for one browser test, driven over stdin and stdout. Playwright's runner needs
 * Node, and legenda needs Bun (`bun:sqlite`), so each test starts this as a process of its own and
 * sends it one JSON command a line: the same helpers the other tests use (a temp database, a free
 * port, a FakeWeb instead of the network), on the same fixed clock.
 */
import {createInterface} from 'node:readline';
import {startInstance} from '../helpers/instance.ts';
import {seeds} from './seeds.ts';

const reply = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

const lg = await startInstance();
reply({url: lg.url, token: lg.token('you')});

for await (const line of createInterface({input: process.stdin})) {
  const command = JSON.parse(line) as {seed?: string; stop?: true};
  try {
    if (command.stop) {
      await lg.stop();
      process.exit(0);
    }
    if (command.seed) reply({ok: await seeds[command.seed]!(lg)});
    else reply({ok: true});
  } catch (error) {
    reply({error: String(error)});
  }
}
