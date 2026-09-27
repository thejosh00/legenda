/**
 * A CLI command is a mapping: flags → one HTTP call → text for a person.
 *
 * With `--json` the server's envelope is printed as it came, so the CLI and the API
 * cannot disagree about shapes.
 */
import type {ParsedArgs} from '../core/args.ts';
import type {ApiCall, ApiResult} from '../client.ts';

export interface CommandIO {
  readStdin(): Promise<string>;
  env: Record<string, string | undefined>;
  /** For the rare command that must read before it writes (`profile edit`). */
  call(call: ApiCall): Promise<ApiResult>;
  /** Open text in the user's editor and return what they saved. */
  edit(text: string): Promise<string>;
}

export interface CommandDef {
  /** One or more words: `list`, `run start`, `youtube search`. */
  name: string;
  summary: string;
  usage: string;
  /** Flags that take a value. */
  values?: readonly string[];
  /** Flags that take none. */
  booleans?: readonly string[];
  alias?: Readonly<Record<string, string>>;
  build(args: ParsedArgs, io: CommandIO): ApiCall | Promise<ApiCall>;
  human(body: Record<string, unknown>, args: ParsedArgs): string | string[];
}

export class CommandUsage extends Error {}
