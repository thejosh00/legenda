/**
 * M7: papers — dedup across ids, follows of each kind, screened intake, recommendations
 * from feedback, and arXiv's rate limit.
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {startInstance, type Instance} from '../helpers/instance.ts';
import {PAPERS, RAFT, RAFT_ARXIV, RAFT_DOI, serveS2} from '../helpers/papers.ts';

let lg: Instance;
const AGENT = {as: 'agent:curator'};

beforeEach(async () => {
  lg = await startInstance({settings: {enabled_sources: 'papers'}});
  await serveS2(lg.web);
});
afterEach(async () => {
  await lg.stop();
});

describe('one paper, many names', () => {
  test('arXiv id, DOI and S2 URL all land on one item', async () => {
    const first = await lg.j(['add', `arXiv:${RAFT_ARXIV}`]);
    expect(first.code).toBe(0);
    expect(first.json.results[0].item).toMatchObject({source: 'papers', external_id: RAFT, title: 'In Search of an Understandable Consensus Algorithm', abstract: expect.any(String)});

    for (const ref of [`https://doi.org/${RAFT_DOI}`, `https://www.semanticscholar.org/paper/raft/${RAFT}`, `https://arxiv.org/pdf/${RAFT_ARXIV}v2.pdf`]) {
      const again = await lg.j(['add', ref]);
      expect({ref, existing: again.json.results[0].existing}).toEqual({ref, existing: true});
    }
    expect((await lg.j(['list'])).json.items).toHaveLength(1);
    // Known ones are recognised without asking Semantic Scholar again.
    expect(lg.web.count('https://api.semanticscholar.org/graph/v1/paper/batch')).toBe(1);
  });

  test('an arXiv-only item from a feed is the same paper once S2 knows it', async () => {
    lg.web.on('https://api.semanticscholar.org/graph/v1/paper/batch', () => Response.json([null, null]));
    await lg.j(['follow', 'papers', 'cs.DC', '--unscreened']);
    await lg.j(['poll']);
    const items = (await lg.j(['list'])).json.items;
    expect(items.map((i: {external_id: string}) => i.external_id).sort()).toEqual(['ARXIV:2609.01001', 'ARXIV:2609.01002']);

    await serveS2(lg.web);
    const run = (await lg.j(['run', 'start'], AGENT)).json.run.id;
    const suggested = await lg.j(['suggest', 'papers', `https://www.semanticscholar.org/paper/x/${'c'.repeat(40)}`, '--reason', 'r', '--run', run], AGENT);
    expect(suggested.json.existing).toBe(true);
    expect(suggested.json.item.external_id).toBe('ARXIV:2609.01002');
  });

  test('details and search mark what is known', async () => {
    await lg.j(['add', `arXiv:${RAFT_ARXIV}`]);
    const details = await lg.j(['papers', 'details', RAFT_DOI, 'arXiv:9999.99999'], AGENT);
    expect(details.json.results).toHaveLength(1);
    expect(details.json.results[0]).toMatchObject({external_id: RAFT, known: 'queue'});
    const search = await lg.j(['papers', 'search', 'consensus', '--year-from', '2000'], AGENT);
    expect(search.json.results.map((r: {known: string | null}) => r.known)).toEqual([null, 'queue']);
    expect(lg.web.requests.find(r => r.url.includes('/paper/search'))!.url).toContain('year=2000-');
  });
});

describe('follows', () => {
  test('an author by id is polled from their papers, unscreened, with backfill', async () => {
    const f = await lg.j(['follow', 'papers', 'https://www.semanticscholar.org/author/Diego-Ongaro/1001']);
    expect(f.json.follow).toMatchObject({kind: 'author', external_id: '1001', title: 'Diego Ongaro', screened: false});
    const polled = await lg.j(['poll']);
    expect(polled.json.results[0].added).toBe(2);
  });

  test('an author by name asks which one, with candidates', async () => {
    const result = await lg.j(['follow', 'papers', 'Diego Ongaro', '--kind', 'author']);
    expect(result.code).toBe(2);
    expect(result.json.candidates[0]).toContain('1001  Diego Ongaro (Stanford)');
  });

  test('categories and queries are screened by default', async () => {
    const category = (await lg.j(['follow', 'papers', 'cs.DC', '--note', 'no surveys'])).json.follow;
    expect(category).toMatchObject({kind: 'category', external_id: 'cs.DC', screened: true});
    const query = (await lg.j(['follow', 'papers', 'raft reconfiguration', '--kind', 'query'])).json.follow;
    expect(query).toMatchObject({kind: 'query', screened: true});

    await lg.j(['poll', '--follow', category.id]);
    const pending = (await lg.j(['intake'], AGENT)).json.intake;
    expect(pending.map((c: {item: {title: string}}) => c.item.title)).toEqual(['A Survey of Consensus', 'Leaderless Replication with Bounded Staleness']);
    // Resolved to S2 ids where S2 knows them.
    expect(pending[1].item.external_id).toBe('c'.repeat(40));

    const [survey, leaderless] = pending;
    await lg.j(['intake', 'pass', survey.id], AGENT);
    await lg.j(['intake', 'accept', leaderless.id, '--reason', 'replication, not a survey'], AGENT);
    expect((await lg.j(['list'])).json.items.map((i: {title: string}) => i.title)).toEqual(['Leaderless Replication with Bounded Staleness']);

    // Polling again offers nothing new: decided candidates are remembered.
    lg.db.query('UPDATE follows SET cursor = NULL WHERE id = ?').run(category.id);
    expect((await lg.j(['poll', '--follow', category.id])).json.results[0].offered).toBe(0);
  });

  test("the poller keeps to arXiv's one request per three seconds", async () => {
    const sleeps: number[] = [];
    let clock = 0;
    const {RateGates} = await import('../../src/sources/rateGate.ts');
    lg.server.deps.gates = new RateGates(
      () => clock,
      async ms => {
        sleeps.push(ms);
        clock += ms;
      },
    );
    await lg.j(['follow', 'papers', 'cs.DC']);
    await lg.j(['follow', 'papers', 'cs.OS']);
    await lg.j(['follow', 'papers', 'math.CO']);
    await lg.j(['poll']);
    expect(lg.web.count('https://export.arxiv.org/api/query')).toBe(3);
    expect(sleeps).toEqual([3000, 3000]);
  });
});

describe('recommendations from feedback', () => {
  test('loved and more-like-this are positive; disliked and not-my-topic negative', async () => {
    const empty = await lg.j(['papers', 'recommend'], AGENT);
    expect(empty.json).toMatchObject({results: [], positive: []});

    const raft = (await lg.j(['add', RAFT, '--source', 'papers'])).json.results[0].item.id;
    const paxos = (await lg.j(['add', PAPERS[1]!.id, '--source', 'papers'])).json.results[0].item.id;
    await lg.j(['done', raft, '--reaction', 'loved']);
    await lg.j(['dismiss', paxos, '--reason', 'not_interested_topic']);

    const result = await lg.j(['papers', 'recommend', '--max', '5'], AGENT);
    expect(result.code).toBe(0);
    expect(result.json.positive).toEqual([RAFT]);
    expect(result.json.negative).toEqual(['b'.repeat(40)]);
    const sent = JSON.parse(lg.web.requests.find(r => r.url.includes('/recommendations/'))!.body!);
    expect(sent).toEqual({positivePaperIds: [RAFT], negativePaperIds: ['b'.repeat(40)]});
    expect(result.json.results[0].title).toBe('Leaderless Replication with Bounded Staleness');
  });
});
