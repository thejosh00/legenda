/**
 * The agent contract is executable: every example command in `legenda agents` runs
 * against a real server and does what the document says. If the CLI or API changes
 * shape, this fails before an agent does.
 */
import {afterEach, expect, test} from 'bun:test';
import {curatorExamples, type Example} from '../../src/core/agentsDoc.ts';
import {contractOptions} from '../../src/db/contract.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';
import {serveS2} from '../helpers/papers.ts';
import {shellWords} from '../helpers/shell.ts';
import {CHANNEL, serveChannel, serveOembed, serveSearchApi, serveVideosApi} from '../helpers/youtube.ts';

let lg: Instance | undefined;
afterEach(async () => {
  await lg?.stop();
  lg = undefined;
});

const AGENT = {as: 'agent:curator'};

/** Seed what the examples refer to: a key, fixtures, and screened candidates to decide. */
async function seed(instance: Instance): Promise<void> {
  await serveChannel(instance.web);
  serveOembed(instance.web);
  serveSearchApi(instance.web, ['exampleVid2']);
  serveVideosApi(instance.web);
  await instance.j(['settings', 'set', 'youtube_api_key', 'k']);
  await instance.j(['follow', 'youtube', CHANNEL, '--screened']);
  await instance.j(['poll']);
}

async function runExamples(instance: Instance, examples: Example[]): Promise<void> {
  let runId = '';
  for (const example of examples) {
    let line = example.line;
    if (line.includes('<intake-id>')) {
      const pending = (await instance.j(['intake'], AGENT)).json.intake;
      expect(pending.length).toBeGreaterThan(0);
      line = line.replace('<intake-id>', pending[0].id);
    }
    line = line.replace(/<run_id>/g, runId);
    if (line.includes('<follow-id>')) line = line.replace(/<follow-id>/g, (await instance.j(['follows', '--source', 'docs'])).json.follows[0].id);
    if (line.includes('<item-id>')) line = line.replace('<item-id>', (await instance.j(['context'], AGENT)).json.needs_enrichment[0].id);
    const argv = shellWords(line);
    expect(argv[0]).toBe('legenda');
    const result = await instance.cli(argv.slice(1), {...AGENT, ...(example.stdin === undefined ? {} : {stdin: example.stdin})});
    expect({line, code: result.code, out: result.code === 0 ? '' : result.stdout}).toEqual({line, code: example.expect ?? 0, out: ''});
    if (argv.includes('--json')) {
      expect(result.json?.ok).toBe(true);
      expect(result.stderr).toBe('');
    }
    if (line.startsWith('legenda run start')) runId = result.json.run.id;
  }
}

test('every example in the YouTube contract runs as documented', async () => {
  lg = await startInstance({settings: {enabled_sources: 'youtube'}});
  await seed(lg);
  const examples = curatorExamples(contractOptions(lg.ctx('agent:curator')));
  expect(examples.some(e => e.section === 'youtube')).toBe(true);
  await runExamples(lg, examples);

  const runs = (await lg.j(['runs'])).json.runs;
  expect(runs[0]).toMatchObject({outcome: 'ok', suggested: 1, from_follows: 1, considered: 24});
});

test('every example in the YouTube + papers contract runs as documented', async () => {
  lg = await startInstance({settings: {enabled_sources: 'youtube,papers'}});
  await seed(lg);
  await serveS2(lg.web);
  const examples = curatorExamples(contractOptions(lg.ctx('agent:curator')));
  expect(examples.some(e => e.section === 'papers')).toBe(true);
  await runExamples(lg, examples);
  expect((await lg.j(['runs'])).json.runs[0]).toMatchObject({outcome: 'ok', suggested: 2});
});

test('every example in a contract with all three sources runs as documented', async () => {
  lg = await startInstance({settings: {enabled_sources: 'youtube,papers,docs', docs_base_url: 'https://docs.example.com/wiki', docs_label: 'Confluence', docs_reauth_hint: 'run "box auth"'}});
  await seed(lg);
  await serveS2(lg.web);
  await lg.j(['follow', 'docs', 'ENG', '--kind', 'collection']);
  await lg.j(['add', 'https://docs.example.com/wiki/spaces/ENG/pages/42/Onboarding']);
  await lg.j(['settings', 'set', 'max_per_creator_per_run', '3']);
  const examples = curatorExamples(contractOptions(lg.ctx('agent:curator')));
  await runExamples(lg, examples);
  expect((await lg.j(['runs'])).json.runs[0]).toMatchObject({outcome: 'ok', suggested: 3, from_follows: 2});
  const doc = (await lg.j(['agents'], AGENT)).json.document as string;
  expect(doc).toContain('When Confluence access expires');
  expect(doc).toContain('run "box auth"');
});

test('the document shows exactly those examples, and only enabled sources', async () => {
  lg = await startInstance({settings: {enabled_sources: 'youtube'}});
  const result = await lg.j(['agents'], AGENT);
  expect(result.code).toBe(0);
  const doc: string = result.json.document;
  for (const example of curatorExamples(contractOptions(lg.ctx('agent:curator')))) expect(doc).toContain(example.line);
  expect(doc).toContain('suggestions per day, all sources | 5 |');
  expect(doc).not.toContain('legenda papers');
  expect(doc).not.toContain('add-found');
  // Steps are numbered without gaps.
  const steps = [...doc.matchAll(/^(\d+)\. \*\*/gm)].map(m => Number(m[1]));
  expect(steps).toEqual(steps.map((_, i) => i + 1));
});

test('the contract reflects this instance\'s limits', async () => {
  lg = await startInstance({settings: {enabled_sources: 'youtube', daily_suggestion_cap: '3'}});
  const doc = (await lg.j(['agents'])).json.document as string;
  expect(doc).toContain('suggestions per day, all sources | 3 |');
});
