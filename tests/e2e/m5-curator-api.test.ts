/**
 * M5: the curator's API for YouTube — settings, quota, search/details, context, runs,
 * and suggest with every limit the server enforces.
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {startInstance, type Instance} from '../helpers/instance.ts';
import {CHANNEL, serveChannel, serveOembed, serveSearchApi, serveVideosApi} from '../helpers/youtube.ts';

let lg: Instance;
const AGENT = {as: 'agent:curator'};
const vid = (n: number) => `vid${String(n).padStart(8, '0')}`;

beforeEach(async () => {
  lg = await startInstance();
  await serveChannel(lg.web);
  serveOembed(lg.web);
});
afterEach(async () => {
  await lg.stop();
});

async function withKey(): Promise<void> {
  expect((await lg.j(['settings', 'set', 'youtube_api_key', 'secret-key-123'])).code).toBe(0);
}

async function startRun(): Promise<string> {
  const started = await lg.j(['run', 'start'], AGENT);
  expect(started.code).toBe(0);
  return started.json.run.id;
}

async function suggest(n: number, run: string, reason = `Because ${n}`) {
  return lg.j(['suggest', 'youtube', `https://youtu.be/${vid(n)}`, '--reason', reason, '--run', run], AGENT);
}

describe('settings', () => {
  test('keys are stored but never echoed', async () => {
    await withKey();
    const all = await lg.j(['settings']);
    expect(all.stdout).not.toContain('secret-key-123');
    expect(all.json.settings.find((s: {key: string}) => s.key === 'youtube_api_key')).toMatchObject({is_set: true, secret: true, value: '(set; hidden)'});
    const one = await lg.cli(['settings', 'get', 'youtube_api_key']);
    expect(one.stdout).not.toContain('secret');
  });

  test('values are validated, and unknown keys refused', async () => {
    expect((await lg.j(['settings', 'set', 'daily_suggestion_cap', 'lots'])).code).toBe(2);
    expect((await lg.j(['settings', 'set', 'nonsense', '1'])).code).toBe(2);
    expect((await lg.j(['settings', 'set', 'enabled_sources', 'youtube,podcasts'])).code).toBe(2);
    expect((await lg.j(['settings', 'set', 'daily_suggestion_cap.youtube', '2'])).json.setting.value).toBe('2');
  });

  test('an agent cannot read or change settings', async () => {
    expect((await lg.j(['settings'], AGENT)).code).toBe(2);
    expect((await lg.j(['settings', 'set', 'daily_suggestion_cap', '99'], AGENT)).code).toBe(2);
  });
});

describe('search and details', () => {
  test('search without a key says so, with exit 1', async () => {
    const result = await lg.j(['youtube', 'search', 'joinery'], AGENT);
    expect(result.code).toBe(1);
    expect(result.json.error).toContain('no YouTube API key');
  });

  test('search spends quota and marks known items and blocked creators', async () => {
    await withKey();
    serveSearchApi(lg.web, [vid(1), vid(2)]);
    serveVideosApi(lg.web, {}, {[vid(2)]: ['UCblockedChannel00000000', 'Blocked Chan']});
    await lg.j(['add', `https://youtu.be/${vid(1)}`]);
    const known = (await lg.j(['show', `https://youtu.be/${vid(1)}`])).json.item.id;
    await lg.j(['dismiss', known]);
    lg.db.query("INSERT INTO follows (id, source, kind, external_id, title, status, fetched_by, added) VALUES ('blk', 'youtube', 'channel', 'UCblockedChannel00000000', 'Blocked Chan', 'blocked', 'app', ?)").run(lg.clock.now);

    const result = await lg.j(['youtube', 'search', 'joinery', '--max', '5'], AGENT);
    expect(result.code).toBe(0);
    expect(result.json.results.map((r: {external_id: string; known: string | null; creator_blocked: boolean}) => [r.external_id, r.known, r.creator_blocked])).toEqual([
      [vid(1), 'dismissed', false],
      [vid(2), null, true],
    ]);
    expect(result.json.results[0].length_minutes).toBe(13);
    const context = (await lg.j(['context'], AGENT)).json;
    // search = 100, one videos.list for durations = 1, plus 1 for the add above.
    expect(context.quota.youtube).toEqual({units_left: 3000 - 102, has_key: true});
  });

  test('the quota ceiling refuses what would pass it', async () => {
    await withKey();
    await lg.j(['settings', 'set', 'youtube_daily_units', '150']);
    serveSearchApi(lg.web, [vid(1)]);
    serveVideosApi(lg.web);
    expect((await lg.j(['youtube', 'search', 'one'], AGENT)).code).toBe(0);
    const second = await lg.j(['youtube', 'search', 'two'], AGENT);
    expect(second.code).toBe(1);
    expect(second.json.error).toContain('quota');
    expect(lg.web.count('https://www.googleapis.com/youtube/v3/search')).toBe(1);
  });

  test('details without a key uses oEmbed', async () => {
    const result = await lg.j(['youtube', 'details', vid(3), `https://youtu.be/${vid(4)}`], AGENT);
    expect(result.json.results.map((r: {title: string}) => r.title)).toEqual([`Video ${vid(3)}`, `Video ${vid(4)}`]);
  });
});

describe('runs', () => {
  test('start, finish, and the log', async () => {
    const run = await startRun();
    const again = await lg.j(['run', 'start'], AGENT);
    expect(again.json).toMatchObject({resumed: true, run: {id: run}});

    const finished = await lg.j(['run', 'finish', run, '--outcome', 'ok', '--queries', '{"youtube":["joinery"]}', '--considered', '12', '--summary', 'Looked for joinery.'], AGENT);
    expect(finished.code).toBe(0);
    expect(finished.json.run).toMatchObject({outcome: 'ok', queries: {youtube: ['joinery']}, considered: 12, summary: 'Looked for joinery.'});
    expect((await lg.j(['run', 'finish', run, '--outcome', 'ok'], AGENT)).code).toBe(2);
    expect((await lg.j(['runs'])).json.runs[0].id).toBe(run);
  });

  test('a stale open run is closed as failed when the next starts', async () => {
    const run = await startRun();
    lg.clock.now = '2026-09-13T15:00:00Z';
    const next = await lg.j(['run', 'start'], AGENT);
    expect(next.json.run.id).not.toBe(run);
    const log = (await lg.j(['runs'])).json.runs;
    expect(log.find((r: {id: string}) => r.id === run)).toMatchObject({outcome: 'failed', summary: 'abandoned: never finished'});
  });

  test('bad outcomes and queries are usage errors; runs are for agents', async () => {
    const run = await startRun();
    expect((await lg.j(['run', 'finish', run, '--outcome', 'great'], AGENT)).code).toBe(2);
    expect((await lg.j(['run', 'finish', run, '--outcome', 'ok', '--queries', 'not json'], AGENT)).code).toBe(2);
    expect((await lg.j(['run', 'start'])).code).toBe(2);
  });
});

describe('suggest', () => {
  test('adds with origin agent, the reason, and the run', async () => {
    const run = await startRun();
    const result = await suggest(1, run, 'Same maker as the dovetail video you loved');
    expect(result.code).toBe(0);
    expect(result.json).toMatchObject({existing: false, item: {origin: 'agent', added_by: 'agent:curator', reason: 'Same maker as the dovetail video you loved', run_id: run, state: 'queue'}});
    expect((await lg.j(['runs'])).json.runs[0]).toMatchObject({suggested: 1, items: [{external_id: vid(1)}]});
  });

  test('is idempotent: a known item returns existing and costs no cap', async () => {
    await lg.j(['settings', 'set', 'daily_suggestion_cap', '1']);
    const run = await startRun();
    await suggest(1, run);
    const again = await suggest(1, run);
    expect(again.code).toBe(0);
    expect(again.json).toMatchObject({existing: true, state: 'queue'});
    // And a dismissed item stays dismissed.
    await lg.j(['dismiss', again.json.item.id]);
    expect((await suggest(1, run)).json).toMatchObject({existing: true, state: 'dismissed'});
  });

  test('the daily cap, overall and per source', async () => {
    await lg.j(['settings', 'set', 'daily_suggestion_cap', '5']);
    await lg.j(['settings', 'set', 'max_per_creator_per_run', '10']);
    await lg.j(['settings', 'set', 'daily_suggestion_cap.youtube', '2']);
    const run = await startRun();
    expect((await suggest(1, run)).code).toBe(0);
    expect((await suggest(2, run)).code).toBe(0);
    const third = await suggest(3, run);
    expect(third.code).toBe(1);
    expect(third.json.error).toContain('daily_suggestion_cap.youtube');

    await lg.j(['settings', 'unset', 'daily_suggestion_cap.youtube']);
    await lg.j(['settings', 'set', 'daily_suggestion_cap', '3']);
    expect((await suggest(3, run)).code).toBe(0);
    expect((await suggest(4, run)).code).toBe(1);

    // A new local day resets it (Chicago: 06:00 UTC on the 13th is still the 13th, 01:00 local).
    lg.clock.now = '2026-09-13T06:00:00Z';
    expect((await suggest(4, run)).code).toBe(0);
    const caps = (await lg.j(['context'], AGENT)).json.caps.suggestions;
    expect(caps).toMatchObject({cap: 3, used: 1, left: 2});
  });

  test('at most N per creator per run', async () => {
    const run = await startRun();
    expect((await suggest(1, run)).code).toBe(0);
    expect((await suggest(2, run)).code).toBe(0);
    const third = await suggest(3, run);
    expect(third.code).toBe(1);
    expect(third.json.error).toContain('max_per_creator_per_run');
    const next = (await lg.j(['run', 'finish', run, '--outcome', 'ok'], AGENT), await startRun());
    expect((await suggest(3, next)).code).toBe(0);
  });

  test('a blocked creator, a missing reason, a missing run, a disabled source', async () => {
    const run = await startRun();
    lg.db.query("INSERT INTO follows (id, source, kind, external_id, title, status, fetched_by, added) VALUES ('blk', 'youtube', 'channel', ?, 'Example Workshop', 'blocked', 'app', ?)").run(CHANNEL, lg.clock.now);
    const blocked = await suggest(1, run);
    expect(blocked.code).toBe(1);
    expect(blocked.json.creator_blocked).toBe(true);

    const noReason = await lg.j(['suggest', 'youtube', vid(5), '--run', run], AGENT);
    expect(noReason.code).toBe(1);
    expect(noReason.json.error).toContain('reason');
    const blank = await lg.j(['suggest', 'youtube', vid(5), '--reason', '  ', '--run', run], AGENT);
    expect(blank.code).toBe(1);

    expect((await lg.j(['suggest', 'youtube', vid(5), '--reason', 'x'], AGENT)).code).toBe(2);

    await lg.j(['settings', 'set', 'enabled_sources', 'papers']);
    expect((await suggest(6, run)).code).toBe(1);
  });

  test('only agents suggest', async () => {
    expect((await lg.j(['suggest', 'youtube', vid(1), '--reason', 'x', '--run', 'r'])).code).toBe(2);
  });
});

describe('screened intake', () => {
  test('accept puts a candidate on the list; pass remembers it; both are counted', async () => {
    await lg.j(['follow', 'youtube', CHANNEL, '--screened', '--note', 'joinery only']);
    await lg.j(['poll']);
    const pending = (await lg.j(['intake'], AGENT)).json.intake;
    expect(pending).toHaveLength(2);
    expect(pending[0].follow).toMatchObject({note: 'joinery only'});
    const [sharpening, dovetails] = pending;

    const run = await startRun();
    const accepted = await lg.j(['intake', 'accept', dovetails.id, '--reason', 'dovetails are joinery', '--run', run], AGENT);
    expect(accepted.code).toBe(0);
    expect(accepted.json.results[0].item).toMatchObject({origin: 'follow', reason: 'dovetails are joinery', added_by: 'agent:curator'});
    expect((await lg.j(['intake', 'pass', sharpening.id], AGENT)).code).toBe(0);
    expect((await lg.j(['intake'], AGENT)).json.intake).toEqual([]);
    expect((await lg.j(['intake', 'pass', sharpening.id], AGENT)).code).toBe(2);

    const context = (await lg.j(['context'], AGENT)).json;
    expect(context.caps.follow_intake).toMatchObject({used: 1});
    expect((await lg.j(['runs'])).json.runs[0].from_follows).toBe(1);
  });

  test('the follow-intake cap', async () => {
    await lg.j(['settings', 'set', 'daily_follow_intake_cap', '1']);
    await lg.j(['follow', 'youtube', CHANNEL, '--screened']);
    await lg.j(['poll']);
    const [a, b] = (await lg.j(['intake'], AGENT)).json.intake;
    expect((await lg.j(['intake', 'accept', a.id, '--reason', 'ok'], AGENT)).code).toBe(0);
    const over = await lg.j(['intake', 'accept', b.id, '--reason', 'ok'], AGENT);
    expect(over.code).toBe(1);
    expect(over.json.error).toContain('daily_follow_intake_cap');
  });

  test('undecided candidates expire after 14 days', async () => {
    const {expireIntake} = await import('../../src/db/intake.ts');
    await lg.j(['follow', 'youtube', CHANNEL, '--screened']);
    await lg.j(['poll']);
    lg.clock.now = '2026-09-27T16:00:00Z';
    expect(expireIntake(lg.ctx('app'))).toBe(2);
    expect((await lg.j(['intake'], AGENT)).json.intake).toEqual([]);
  });
});

describe('context', () => {
  test('has everything a run needs', async () => {
    await lg.j(['interest', 'add', 'joinery', '--strength', 'core']);
    await lg.j(['follow', 'youtube', CHANNEL, '--note', 'all of it']);
    const id = (await lg.j(['add', `https://youtu.be/${vid(1)}`])).json.results[0].item.id;
    await lg.j(['done', id, '--reaction', 'loved']);
    const run = await startRun();
    await lg.j(['run', 'finish', run, '--outcome', 'ok', '--summary', 'first'], AGENT);

    const context = (await lg.j(['context'], AGENT)).json;
    expect(Object.keys(context).sort()).toEqual(
      ['ok', 'now', 'actor', 'enabled_sources', 'sources', 'profile', 'interests', 'follows', 'feedback', 'recent_items', 'caps', 'quota', 'intake_pending', 'needs_enrichment', 'recent_runs', 'open_run'].sort(),
    );
    expect(context.enabled_sources).toEqual(['youtube', 'papers']);
    expect(context.interests[0].topic).toBe('joinery');
    expect(context.follows[0]).toMatchObject({title: 'Example Workshop', note: 'all of it', fetched_by: 'app', screened: false});
    expect(context.feedback[0]).toMatchObject({kind: 'loved', item: {title: `Video ${vid(1)}`, source: 'youtube', origin: 'you'}});
    expect(context.recent_items[0]).toMatchObject({id, state: 'done'});
    expect(context.recent_runs[0]).toMatchObject({outcome: 'ok', summary: 'first'});
    expect(context.quota.youtube).toEqual({units_left: 3000, has_key: false});
    expect(context).not.toHaveProperty('docs');
  });
});
