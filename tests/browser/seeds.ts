/**
 * What a browser test starts from, built through the real CLI against the instance's FakeWeb, on
 * the instance's fixed clock. Generic content only: nothing personal belongs in fixtures.
 */
import type {CliResult, Instance} from '../helpers/instance.ts';
import {PAPERS, RAFT_ARXIV, serveS2} from '../helpers/papers.ts';
import {CHANNEL, serveChannel, serveOembed} from '../helpers/youtube.ts';

const AGENT = {as: 'agent:curator'};
const DOCS = 'https://docs.example.com/wiki';

const doc = (id: string, title: string, summary: string) =>
  JSON.stringify({external_id: id, url: `${DOCS}/spaces/ENG/pages/${id}/Title`, title, creator: 'A. Author', container: 'Engineering', published: '2026-09-10T12:00:00Z', length_minutes: 12, labels: ['rfc'], summary});

/** Run the CLI as JSON, and fail the seed loudly if legenda refused. */
async function must(lg: Instance, args: string[], options?: {as?: string}): Promise<any> {
  const result: CliResult = await lg.j(args, options);
  if (result.code !== 0) throw new Error(`legenda ${args.join(' ')} exited ${result.code}: ${result.stdout} ${result.stderr}`);
  return result.json;
}

export const seeds: Record<string, (lg: Instance) => Promise<unknown>> = {
  /** Nothing at all: the list a new user sees. */
  empty: async () => ({}),

  /** Items from all three sources, added by hand, by a follow and by the curator; three follows; one finished run. */
  everything: async lg => {
    await serveChannel(lg.web);
    serveOembed(lg.web);
    await serveS2(lg.web);
    await must(lg, ['settings', 'set', 'docs_base_url', DOCS]);
    await must(lg, ['settings', 'set', 'docs_label', 'Confluence']);
    await must(lg, ['settings', 'set', 'enabled_sources', 'youtube,papers,docs']);

    // Added by hand.
    await must(lg, ['add', 'https://youtu.be/vid00000001']);
    await must(lg, ['add', `arXiv:${RAFT_ARXIV}`]);

    const follows = {
      channel: (await must(lg, ['follow', 'youtube', CHANNEL, '--screened', '--note', 'joinery only'])).follow.id as string,
      category: (await must(lg, ['follow', 'papers', 'cs.DC', '--note', 'no surveys'])).follow.id as string,
      space: (await must(lg, ['follow', 'docs', 'ENG', '--kind', 'collection', '--note', 'only RFCs and design docs'])).follow.id as string,
    };

    // One curator run: a suggestion from each source with its reason, and a doc from the followed space.
    const run = (await must(lg, ['run', 'start'], AGENT)).run.id as string;
    await must(lg, ['suggest', 'youtube', 'https://youtu.be/vid00000002', '--reason', 'Same maker as the dovetail video you finished', '--run', run], AGENT);
    await must(lg, ['suggest', 'papers', `https://www.semanticscholar.org/paper/x/${PAPERS[1]!.id}`, '--reason', 'The paper Raft was written in answer to', '--run', run], AGENT);
    await must(lg, ['add-found', 'docs', '--run', run, '--origin', 'agent', '--reason', 'Consensus design, your core interest', '--json-item', doc('2', 'RFC: Leader election for the job scheduler', 'Proposes Raft-style leader election for the scheduler.')], AGENT);
    await must(lg, ['add-found', 'docs', '--run', run, '--origin', 'follow', '--follow', follows.space, '--json-item', doc('1', 'Design: Storage tiering', 'How cold data moves to cheaper storage, and when.')], AGENT);
    await must(lg, ['run', 'finish', run, '--outcome', 'ok', '--queries', '{"youtube":["joinery"],"papers":["consensus"]}', '--considered', '12', '--summary', 'Looked for joinery and consensus.'], AGENT);

    return {follows, run, items: (await must(lg, ['list'])).items.map((i: {source: string; title: string}) => `${i.source}: ${i.title}`)};
  },
};
