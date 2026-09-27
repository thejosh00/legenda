/**
 * M8: docs, fed by the agent — add-found's checks, idempotence by page id, enrichment of
 * pasted links, the follow-intake cap, and who may move a cursor.
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {startInstance, type Instance} from '../helpers/instance.ts';

const BASE = 'https://docs.example.com/wiki';
const AGENT = {as: 'agent:curator'};
let lg: Instance;
let run: string;
let follow: string;

const page = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({external_id: id, url: `${BASE}/spaces/ENG/pages/${id}/Title`, title: `Page ${id}`, creator: 'A. Author', container: 'Engineering', published: '2026-09-10T12:00:00Z', length_minutes: 12, labels: ['rfc'], summary: 'Two lines about it.', ...extra});

const addFound = (args: string[]) => lg.j(['add-found', 'docs', '--run', run, ...args], AGENT);

beforeEach(async () => {
  lg = await startInstance({settings: {enabled_sources: 'docs', docs_base_url: BASE, docs_label: 'Confluence', docs_reauth_hint: 'run "sandbox auth"'}});
  follow = (await lg.j(['follow', 'docs', 'ENG', '--kind', 'collection', '--note', 'only RFCs and design docs'])).json.follow.id;
  run = (await lg.j(['run', 'start'], AGENT)).json.run.id;
});
afterEach(async () => {
  await lg.stop();
});

describe('add-found', () => {
  test('a follow item and an agent pick, with labels and summary', async () => {
    const viaFollow = await addFound(['--origin', 'follow', '--follow', follow, '--json-item', page('1')]);
    expect(viaFollow.code).toBe(0);
    expect(viaFollow.json.item).toMatchObject({source: 'docs', external_id: '1', origin: 'follow', follow_id: follow, summary: 'Two lines about it.', extra: {labels: ['rfc']}, run_id: run});

    const pick = await addFound(['--origin', 'agent', '--reason', 'consensus design, your core interest', '--json-item', page('2')]);
    expect(pick.json.item).toMatchObject({origin: 'agent', reason: 'consensus design, your core interest'});
    expect((await lg.j(['runs'])).json.runs[0]).toMatchObject({suggested: 1, from_follows: 1});
  });

  test('is idempotent by page id', async () => {
    await addFound(['--origin', 'follow', '--follow', follow, '--json-item', page('1')]);
    const again = await addFound(['--origin', 'agent', '--reason', 'r', '--json-item', page('1', {title: 'Renamed'})]);
    expect(again.json).toMatchObject({existing: true, item: {title: 'Page 1', origin: 'follow'}});
    // The user pasting the same page's link finds it too.
    expect((await lg.j(['add', `${BASE}/spaces/ENG/pages/1`])).json.results[0].existing).toBe(true);
  });

  test('refuses a missing summary, a URL outside the base, a missing reason, a too-long summary', async () => {
    const cases: Array<[string[], string]> = [
      [['--origin', 'follow', '--follow', follow, '--json-item', page('3', {summary: ''})], 'summary'],
      [['--origin', 'follow', '--follow', follow, '--json-item', page('3', {url: 'https://elsewhere.example.org/pages/3'})], 'docs_base_url'],
      [['--origin', 'agent', '--json-item', page('3')], 'reason'],
      [['--origin', 'follow', '--follow', follow, '--json-item', page('3', {summary: 'x'.repeat(401)})], 'summary_max_chars'],
      [['--origin', 'follow', '--follow', follow, '--json-item', page('4', {url: `${BASE}/spaces/ENG/pages/5/Other`})], 'does not match'],
    ];
    for (const [args, message] of cases) {
      const result = await addFound(args);
      expect({message, code: result.code}).toEqual({message, code: 1});
      expect(result.json.error).toContain(message);
    }
    expect((await lg.j(['list'])).json.items).toEqual([]);
  });

  test('refuses a disabled source', async () => {
    await lg.j(['settings', 'set', 'enabled_sources', 'youtube']);
    const result = await addFound(['--origin', 'agent', '--reason', 'r', '--json-item', page('1')]);
    expect(result.code).toBe(1);
    expect(result.json.error).toContain('not enabled');
  });

  test('refuses everything until docs_base_url is set', async () => {
    await lg.j(['settings', 'unset', 'docs_base_url']);
    const result = await addFound(['--origin', 'agent', '--reason', 'r', '--json-item', page('1')]);
    expect(result.code).toBe(1);
    expect(result.json.error).toContain('docs_base_url is not set');
  });

  test('follow items count against the follow-intake cap', async () => {
    await lg.j(['settings', 'set', 'daily_follow_intake_cap', '1']);
    expect((await addFound(['--origin', 'follow', '--follow', follow, '--json-item', page('1')])).code).toBe(0);
    const over = await addFound(['--origin', 'follow', '--follow', follow, '--json-item', page('2')]);
    expect(over.code).toBe(1);
    expect(over.json.error).toContain('daily_follow_intake_cap');
  });

  test('only agents add what they found', async () => {
    expect((await lg.j(['add-found', 'docs', '--run', run, '--origin', 'agent', '--reason', 'r', '--json-item', page('1')])).code).toBe(2);
  });
});

describe('links the user pastes', () => {
  test('are stored bare, listed for enrichment, then filled without overwriting', async () => {
    const added = await lg.j(['add', `${BASE}/spaces/ENG/pages/77/Onboarding`]);
    expect(added.json.results[0].item).toMatchObject({external_id: '77', title: '', summary: null, origin: 'you'});
    const id = added.json.results[0].item.id;

    const context = (await lg.j(['context'], AGENT)).json;
    expect(context.needs_enrichment).toEqual([{id, source: 'docs', external_id: '77', url: `${BASE}/spaces/ENG/pages/77/Onboarding`, title: ''}]);
    expect(context.docs).toEqual({label: 'Confluence', item_label: 'page', base_url: BASE, query_hint: null, reauth_hint: 'run "sandbox auth"'});

    const enriched = await lg.j(['enrich', id, '--json-item', JSON.stringify({title: 'Onboarding', creator: 'B', summary: 'How to start.', labels: ['howto']})], AGENT);
    expect(enriched.json.filled).toEqual(['title', 'creator', 'summary', 'labels']);
    const again = await lg.j(['enrich', id, '--json-item', JSON.stringify({title: 'Other', summary: 'Different.'})], AGENT);
    expect(again.json.filled).toEqual([]);
    expect(again.json.item).toMatchObject({title: 'Onboarding', summary: 'How to start.'});
    expect((await lg.j(['context'], AGENT)).json.needs_enrichment).toEqual([]);
  });

  test('a link outside the base URL is not recognised', async () => {
    expect((await lg.j(['add', 'https://elsewhere.example.org/pages/1'])).code).toBe(2);
  });
});

describe('cursors', () => {
  test('only an agent moves a cursor, and only on an agent-fed follow', async () => {
    const moved = await lg.j(['follow', 'cursor', follow, '2026-09-10T12:00:00Z'], AGENT);
    expect(moved.code).toBe(0);
    expect(moved.json.follow.cursor).toBe('2026-09-10T12:00:00Z');

    const byUser = await lg.j(['follow', 'cursor', follow, '2026-09-11T00:00:00Z']);
    expect(byUser.code).toBe(2);

    await lg.j(['settings', 'set', 'enabled_sources', 'docs,youtube']);
    lg.db.query("INSERT INTO follows (id, source, kind, external_id, title, status, fetched_by, added) VALUES ('ytf', 'youtube', 'channel', 'UCx', 'A channel', 'following', 'app', ?)").run(lg.clock.now);
    const appFed = await lg.j(['follow', 'cursor', 'ytf', '2026-09-10T12:00:00Z'], AGENT);
    expect(appFed.code).toBe(2);
    expect(appFed.json.error).toContain('polled by the app');
  });

  test('docs follows are screened and agent-fed', async () => {
    const f = (await lg.j(['follows'])).json.follows[0];
    expect(f).toMatchObject({source: 'docs', kind: 'collection', external_id: 'ENG', fetched_by: 'agent', screened: true, note: 'only RFCs and design docs'});
    expect((await lg.j(['follow', 'docs', 'ENG'])).code).toBe(2);
  });
});
