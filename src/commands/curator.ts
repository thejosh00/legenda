import {flagValue} from '../core/args.ts';
import type {Item} from '../core/types.ts';
import type {Annotated} from '../db/curator.ts';
import type {IntakeJson} from '../db/intake.ts';
import type {Run} from '../db/runs.ts';
import {age, itemLine} from './render.ts';
import {CommandUsage, type CommandDef} from './types.ts';

const resultLines = (body: Record<string, unknown>) => {
  const results = body['results'] as Annotated[];
  if (results.length === 0) return typeof body['note'] === 'string' ? body['note'] : 'nothing found';
  return results.map(r => {
    const flags = [r.known === null ? '' : `known:${r.known}`, r.creator_blocked ? 'creator blocked' : ''].filter(Boolean).join(', ');
    const bits = [r.creator, r.container ?? '', r.length_minutes === null ? '' : `${r.length_minutes}m`, age(r.published ?? null)].filter(Boolean).join(', ');
    return `${r.external_id}  ${r.title}${bits ? `  — ${bits}` : ''}${flags ? `  [${flags}]` : ''}`;
  });
};

function sourceCommands(source: 'youtube' | 'papers'): CommandDef[] {
  const searchValues = source === 'youtube' ? ['max', 'published-after', 'duration'] : ['max', 'year-from'];
  const searchUsage =
    source === 'youtube'
      ? 'legenda youtube search "<q>" [--max 10] [--published-after <iso>] [--duration short|medium|long]'
      : 'legenda papers search "<q>" [--max 20] [--year-from N]';
  const commands: CommandDef[] = [
    {
      name: `${source} search`,
      summary: `(agent) search ${source === 'youtube' ? 'YouTube' : 'papers'} through the app`,
      usage: searchUsage,
      values: searchValues,
      build: args => {
        const q = args.positional.join(' ').trim();
        if (q === '') throw new CommandUsage(`usage: ${searchUsage}`);
        return {
          method: 'GET',
          path: `/api/sources/${source}/search`,
          query: {
            q,
            max: flagValue(args, 'max'),
            published_after: flagValue(args, 'published-after'),
            duration: flagValue(args, 'duration'),
            year_from: flagValue(args, 'year-from'),
          },
        };
      },
      human: resultLines,
    },
    {
      name: `${source} details`,
      summary: `(agent) look up ${source === 'youtube' ? 'videos' : 'papers'} by id or URL`,
      usage: source === 'youtube' ? 'legenda youtube details <id|url…>' : 'legenda papers details <arxiv-id|doi|url|s2-id…>',
      build: args => {
        if (args.positional.length === 0) throw new CommandUsage(`usage: legenda ${source} details <ref…>`);
        return {method: 'POST', path: `/api/sources/${source}/details`, body: {refs: args.positional}};
      },
      human: resultLines,
    },
  ];
  if (source === 'papers') {
    commands.push({
      name: 'papers recommend',
      summary: '(agent) papers recommended from your feedback',
      usage: 'legenda papers recommend [--max 20]',
      values: ['max'],
      build: args => ({method: 'GET', path: '/api/sources/papers/recommend', query: {max: flagValue(args, 'max')}}),
      human: resultLines,
    });
  }
  return commands;
}

function parseItemJson(text: string | undefined): Record<string, unknown> {
  if (text === undefined) throw new CommandUsage('--json-item is required');
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  throw new CommandUsage('--json-item must be a JSON object');
}

const runLine = (run: Run) =>
  `${run.id}  ${run.started}  ${run.outcome ?? 'running'}  ${run.suggested} suggested, ${run.from_follows} from follows${run.summary ? `  — ${run.summary}` : ''}`;

export const curatorCommands: CommandDef[] = [
  {
    name: 'agents',
    summary: 'the contract an AI agent should follow, for this instance',
    usage: 'legenda agents',
    build: () => ({method: 'GET', path: '/api/agents'}),
    human: body => String(body['document']).trimEnd(),
  },
  {
    name: 'context',
    summary: '(agent) everything a curator run needs, in one call',
    usage: 'legenda context --json',
    build: () => ({method: 'GET', path: '/api/context'}),
    human: body => {
      const caps = body['caps'] as {suggestions: {left: number; cap: number}; follow_intake: {left: number; cap: number}};
      return [
        `sources: ${(body['enabled_sources'] as string[]).join(', ')}`,
        `suggestions left today: ${caps.suggestions.left} of ${caps.suggestions.cap}; follow intake left: ${caps.follow_intake.left} of ${caps.follow_intake.cap}`,
        `intake pending: ${String(body['intake_pending'])}`,
        'use --json for the whole context',
      ];
    },
  },
  {
    name: 'run start',
    summary: '(agent) start a curator run',
    usage: 'legenda run start --json',
    build: () => ({method: 'POST', path: '/api/runs'}),
    human: body => `${body['resumed'] === true ? 'resumed' : 'started'} run ${(body['run'] as Run).id}`,
  },
  {
    name: 'run finish',
    summary: '(agent) finish a curator run with its outcome and summary',
    usage: 'legenda run finish <run_id> --outcome ok|partial|needs_auth|failed --queries \'<json>\' --considered N --summary "…"',
    values: ['outcome', 'queries', 'considered', 'summary'],
    build: args => {
      const id = args.positional[0];
      if (id === undefined) throw new CommandUsage('which run? legenda run finish <run_id> --outcome …');
      return {
        method: 'POST',
        path: `/api/runs/${encodeURIComponent(id)}/finish`,
        body: {outcome: flagValue(args, 'outcome'), queries: flagValue(args, 'queries'), considered: flagValue(args, 'considered'), summary: flagValue(args, 'summary')},
      };
    },
    human: body => `finished: ${runLine(body['run'] as Run)}`,
  },
  {
    name: 'runs',
    summary: 'the curator log',
    usage: 'legenda runs [--limit N]',
    values: ['limit'],
    build: args => ({method: 'GET', path: '/api/runs', query: {limit: flagValue(args, 'limit')}}),
    human: body => {
      const runs = body['runs'] as Array<Run & {items: Item[]}>;
      if (runs.length === 0) return 'the curator has not run yet';
      return runs.flatMap(run => [runLine(run), ...run.items.map(i => `    ${itemLine(i)}`)]);
    },
  },
  ...sourceCommands('youtube'),
  ...sourceCommands('papers'),
  {
    name: 'suggest',
    summary: '(agent) add a video or paper, with the reason it was picked',
    usage: 'legenda suggest <source> <url|id> --reason "<why>" --run <run_id>',
    values: ['reason', 'run'],
    build: args => {
      const [source, ref] = args.positional;
      if (source === undefined || ref === undefined) throw new CommandUsage('usage: legenda suggest <source> <url|id> --reason "…" --run <run_id>');
      return {method: 'POST', path: '/api/suggest', body: {source, ref, reason: flagValue(args, 'reason'), run: flagValue(args, 'run')}};
    },
    human: body => `${body['existing'] === true ? 'already known' : 'suggested'}: ${itemLine(body['item'] as Item)}`,
  },
  {
    name: 'add-found',
    summary: '(agent) add a doc you found, with a summary',
    usage: "legenda add-found docs --run <run_id> --origin follow|agent [--follow <id>] --json-item '<{external_id,url,title,creator,container,published,length_minutes,labels,summary}>' [--reason \"<why>\"]",
    values: ['run', 'origin', 'follow', 'json-item', 'reason'],
    build: args => {
      const source = args.positional[0];
      if (source === undefined) throw new CommandUsage('usage: legenda add-found docs --run <run_id> --origin follow|agent --json-item \'{…}\'');
      return {
        method: 'POST',
        path: '/api/add-found',
        body: {source, run: flagValue(args, 'run'), origin: flagValue(args, 'origin'), follow: flagValue(args, 'follow'), reason: flagValue(args, 'reason'), item: parseItemJson(flagValue(args, 'json-item'))},
      };
    },
    human: body => `${body['existing'] === true ? 'already known' : 'added'}: ${itemLine(body['item'] as Item)}`,
  },
  {
    name: 'enrich',
    summary: '(agent) fill in the details of a doc the user added by URL',
    usage: "legenda enrich <item> --json-item '<{title,creator,container,published,length_minutes,summary}>'",
    values: ['json-item'],
    build: args => {
      const ref = args.positional[0];
      if (ref === undefined) throw new CommandUsage("usage: legenda enrich <item> --json-item '{…}'");
      return {method: 'POST', path: `/api/items/${encodeURIComponent(ref)}/enrich`, body: {item: parseItemJson(flagValue(args, 'json-item'))}};
    },
    human: body => {
      const filled = body['filled'] as string[];
      return filled.length === 0 ? 'nothing to fill: those fields are already set' : `filled ${filled.join(', ')}: ${itemLine(body['item'] as Item)}`;
    },
  },
  {
    name: 'intake',
    summary: 'candidates from screened follows, waiting for a decision',
    usage: 'legenda intake [--source …]',
    values: ['source'],
    build: args => ({method: 'GET', path: '/api/intake', query: {source: flagValue(args, 'source')}}),
    human: body => {
      const intake = body['intake'] as IntakeJson[];
      if (intake.length === 0) return 'nothing waiting';
      return intake.map(c => `${c.id}  ${c.item.title}  — ${c.item.creator}  (from ${c.follow?.title ?? '?'}${c.follow?.note ? `: “${c.follow.note}”` : ''})`);
    },
  },
  {
    name: 'intake accept',
    summary: 'accept screened candidates onto the list',
    usage: 'legenda intake accept <intake-id…> --reason "<why it passes the follow\'s rule>" [--run <run_id>]',
    values: ['reason', 'run'],
    build: args => {
      if (args.positional.length === 0) throw new CommandUsage('which candidates? legenda intake accept <intake-id…> --reason "…"');
      return {method: 'POST', path: '/api/intake/accept', body: {ids: args.positional, reason: flagValue(args, 'reason'), run: flagValue(args, 'run')}};
    },
    human: body => (body['results'] as Array<{item: Item; existing: boolean}>).map(r => `${r.existing ? 'already known' : 'accepted'}: ${itemLine(r.item)}`),
  },
  {
    name: 'intake pass',
    summary: 'pass on screened candidates',
    usage: 'legenda intake pass <intake-id…>',
    build: args => {
      if (args.positional.length === 0) throw new CommandUsage('which candidates? legenda intake pass <intake-id…>');
      return {method: 'POST', path: '/api/intake/pass', body: {ids: args.positional}};
    },
    human: body => `passed ${(body['results'] as unknown[]).length}`,
  },
];
