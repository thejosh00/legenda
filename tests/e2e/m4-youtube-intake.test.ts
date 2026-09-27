/**
 * M4: YouTube intake — the poller, backfill, Shorts, durations, and isolation between
 * follows. The network is fixtures only.
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {fixture} from '../helpers/fakeWeb.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';
import {CHANNEL, FEED, serveChannel, serveVideosApi} from '../helpers/youtube.ts';

let lg: Instance;

beforeEach(async () => {
  lg = await startInstance();
  await serveChannel(lg.web);
});
afterEach(async () => {
  await lg.stop();
});

async function follow(ref = CHANNEL, extra: string[] = []): Promise<string> {
  const result = await lg.j(['follow', 'youtube', ref, ...extra]);
  expect(result.code).toBe(0);
  return result.json.follow.id;
}

const titles = async () => (await lg.j(['list', '--state', 'all'])).json.items.map((i: {external_id: string}) => i.external_id).sort();

describe('polling a channel', () => {
  test('the first poll backfills the newest videos, skipping Shorts', async () => {
    const id = await follow();
    const polled = await lg.j(['poll']);
    expect(polled.code).toBe(0);
    expect(polled.json.results[0]).toMatchObject({follow_id: id, added: 2, skipped: 1, error: null});
    expect(await titles()).toEqual(['vidAAAAAAA1', 'vidAAAAAAA3']);

    const [item] = (await lg.j(['list', '--origin', 'follow', '--limit', '1'])).json.items;
    expect(item).toMatchObject({origin: 'follow', follow_id: id, added_by: 'app'});
    const f = (await lg.j(['follows'])).json.follows[0];
    expect(f).toMatchObject({cursor: '2026-09-12T14:00:00Z', last_error: null});
    expect(f.last_checked).not.toBeNull();
  });

  test('later polls take only newer uploads, and dismissed videos never come back', async () => {
    await follow();
    await lg.j(['poll']);
    const newest = (await lg.j(['show', 'https://youtu.be/vidAAAAAAA3'])).json.item.id;
    await lg.j(['dismiss', newest]);

    const feed = (await fixture('youtube-feed.xml')).replace(
      '<entry>',
      `<entry><yt:videoId>vidAAAAAAA4</yt:videoId><yt:channelId>${CHANNEL}</yt:channelId><title>New one</title><link rel="alternate" href="https://www.youtube.com/watch?v=vidAAAAAAA4"/><author><name>Example Workshop</name></author><published>2026-09-13T09:00:00+00:00</published></entry><entry>`,
    );
    lg.web.on(FEED, feed);
    const second = await lg.j(['poll']);
    expect(second.json.results[0].added).toBe(1);
    expect(await titles()).toEqual(['vidAAAAAAA1', 'vidAAAAAAA3', 'vidAAAAAAA4']);
    expect((await lg.j(['show', newest])).json.item.state).toBe('dismissed');

    // Polling again changes nothing.
    expect((await lg.j(['poll'])).json.results[0].added).toBe(0);
  });

  test('with a key, durations are filled and Shorts are caught by length', async () => {
    lg.db.query("INSERT INTO settings VALUES ('youtube_api_key', 'test-key')").run();
    serveVideosApi(lg.web, {vidAAAAAAA3: 'PT21M', vidAAAAAAA1: 'PT45S'});
    await follow();
    await lg.j(['poll']);
    const items = (await lg.j(['list'])).json.items;
    expect(items.map((i: {external_id: string; length_minutes: number}) => [i.external_id, i.length_minutes])).toEqual([['vidAAAAAAA3', 21]]);
    expect(lg.web.count('https://www.googleapis.com/youtube/v3/videos')).toBe(1);
  });

  test('one failing follow does not stop the others', async () => {
    const other = 'UCbrokenChannel000000000';
    lg.web.on(`https://www.youtube.com/feeds/videos.xml?channel_id=${other}`, {title: 'x'});
    const broken = await follow(other);
    lg.web.on(`https://www.youtube.com/feeds/videos.xml?channel_id=${other}`, 'gone', 404);
    const good = await follow();

    const results = (await lg.j(['poll'])).json.results;
    expect(results.find((r: {follow_id: string}) => r.follow_id === broken).error).toContain('404');
    expect(results.find((r: {follow_id: string}) => r.follow_id === good).added).toBe(2);
    const follows = (await lg.j(['follows'])).json.follows;
    expect(follows.find((f: {id: string}) => f.id === broken).last_error).toContain('404');
  });

  test('a screened follow offers its videos for screening instead', async () => {
    await follow(CHANNEL, ['--screened', '--note', 'joinery only']);
    const polled = await lg.j(['poll']);
    expect(polled.json.results[0]).toMatchObject({added: 0, offered: 2});
    expect((await lg.j(['list'])).json.items).toEqual([]);
    const pending = lg.db.query('SELECT COUNT(*) AS n FROM intake WHERE decided IS NULL').get() as {n: number};
    expect(pending.n).toBe(2);
  });

  test('no test reaches the network: every request went to a fixture', async () => {
    await follow();
    await lg.j(['poll']);
    expect(lg.web.requests.every(r => r.url.startsWith('https://www.youtube.com/'))).toBe(true);
  });
});
