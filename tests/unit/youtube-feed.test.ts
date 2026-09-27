import {describe, expect, test} from 'bun:test';
import {selectNew} from '../../src/core/poll.ts';
import type {ItemInput} from '../../src/core/types.ts';
import {durationSeconds, isShort, parseUploadsFeed, videoFromApi, videoFromOembed} from '../../src/core/youtube.ts';
import {fixture} from '../helpers/fakeWeb.ts';

describe('the uploads feed', () => {
  test('parses entries with ids, titles, dates, thumbnails and the channel', async () => {
    const feed = parseUploadsFeed(await fixture('youtube-feed.xml'));
    expect(feed.channelId).toBe('UCexampleChannel0000000A');
    expect(feed.title).toBe('Example Workshop');
    expect(feed.entries).toHaveLength(3);
    expect(feed.entries[0]).toMatchObject({
      source: 'youtube',
      external_id: 'vidAAAAAAA3',
      url: 'https://www.youtube.com/watch?v=vidAAAAAAA3',
      title: 'Dovetails & half-blind joints, by hand',
      creator: 'Example Workshop',
      creator_external_id: 'UCexampleChannel0000000A',
      published: '2026-09-12T14:00:00Z',
      thumbnail: 'https://i2.ytimg.com/vi/vidAAAAAAA3/hqdefault.jpg',
    });
  });

  test('Shorts are recognised by their feed link', async () => {
    const feed = parseUploadsFeed(await fixture('youtube-feed.xml'));
    expect(feed.entries.map(isShort)).toEqual([false, true, false]);
  });

  test('an empty or broken feed is just empty', () => {
    expect(parseUploadsFeed('').entries).toEqual([]);
    expect(parseUploadsFeed('<feed><entry><title>no id</title></entry></feed>').entries).toEqual([]);
  });
});

describe('durations', () => {
  test.each([
    ['PT12M30S', 750],
    ['PT1H', 3600],
    ['PT45S', 45],
    ['P1DT2H', 93600],
    ['P0D', 0],
  ])('%s', (iso, seconds) => {
    expect(durationSeconds(iso)).toBe(seconds);
  });

  test('API resources carry minutes and seconds', () => {
    const item = videoFromApi({id: 'x'.repeat(11), snippet: {title: 't', channelId: 'UC1', channelTitle: 'c'}, contentDetails: {duration: 'PT59S'}})!;
    expect(item.length_minutes).toBe(1);
    expect(isShort(item)).toBe(true);
  });

  test('oEmbed has no duration', () => {
    const item = videoFromOembed('x'.repeat(11), {title: 't', author_name: 'a', author_url: 'https://www.youtube.com/@a'});
    expect(item).toMatchObject({length_minutes: null, creator_external_id: null, extra: {channel_url: 'https://www.youtube.com/@a'}});
  });
});

describe('selecting new entries', () => {
  const at = (id: string, published: string): ItemInput => ({source: 'youtube', external_id: id, url: id, title: id, creator: '', published});
  const entries = [at('c', '2026-09-03T00:00:00Z'), at('a', '2026-09-01T00:00:00Z'), at('b', '2026-09-02T00:00:00Z')];

  test('the first poll takes the newest N, oldest first', () => {
    const selection = selectNew(entries, null, 2);
    expect(selection.take.map(e => e.external_id)).toEqual(['b', 'c']);
    expect(selection.cursor).toBe('2026-09-03T00:00:00Z');
  });

  test('later polls take only what is newer than the cursor', () => {
    expect(selectNew(entries, '2026-09-01T12:00:00Z', 2).take.map(e => e.external_id)).toEqual(['b', 'c']);
    expect(selectNew(entries, '2026-09-03T00:00:00Z', 2)).toEqual({take: [], cursor: '2026-09-03T00:00:00Z'});
  });

  test('a backfill of zero takes nothing but still sets the cursor', () => {
    expect(selectNew(entries, null, 0)).toEqual({take: [], cursor: '2026-09-03T00:00:00Z'});
  });
});
