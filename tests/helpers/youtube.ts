/** Fixture responses for the YouTube endpoints the adapter calls. */
import type {FakeWeb} from './fakeWeb.ts';
import {fixture} from './fakeWeb.ts';
import {parseUploadsFeed} from '../../src/core/youtube.ts';

export const CHANNEL = 'UCexampleChannel0000000A';
export const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;

/** A channel page as YouTube serves it, reduced to what legenda reads: its id and name. */
export const channelPage = (id: string, title: string) =>
  `<html><link rel="canonical" href="https://www.youtube.com/channel/${id}"><meta property="og:title" content="${title}"></html>`;

export async function serveChannel(web: FakeWeb): Promise<void> {
  web.on(FEED, await fixture('youtube-feed.xml'));
  web.on(`https://www.youtube.com/channel/${CHANNEL}`, channelPage(CHANNEL, 'Example Workshop'));
  web.on('https://www.youtube.com/@exampleworkshop', channelPage(CHANNEL, 'Example Workshop'));
}

/** oEmbed for any video: title from the id, the example channel as author. */
export function serveOembed(web: FakeWeb): void {
  web.on('https://www.youtube.com/oembed', url => {
    const video = new URL(url.searchParams.get('url')!).searchParams.get('v');
    return Response.json({
      title: `Video ${video}`,
      author_name: 'Example Workshop',
      author_url: `https://www.youtube.com/channel/${CHANNEL}`,
      thumbnail_url: `https://i.ytimg.com/vi/${video}/hqdefault.jpg`,
    });
  });
}

/** Data API videos.list: every requested id gets a video; durations from `durations`. */
export function serveVideosApi(web: FakeWeb, durations: Record<string, string> = {}, channels: Record<string, [string, string]> = {}): void {
  web.on('https://www.googleapis.com/youtube/v3/videos', url => {
    const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
    return Response.json({
      items: ids.map(id => {
        const [channelId, channelTitle] = channels[id] ?? [CHANNEL, 'Example Workshop'];
        return {
          id,
          snippet: {title: `Video ${id}`, channelId, channelTitle, publishedAt: '2026-09-10T12:00:00Z', thumbnails: {medium: {url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`}}, liveBroadcastContent: 'none'},
          contentDetails: {duration: durations[id] ?? 'PT12M30S'},
        };
      }),
    });
  });
}

/** Data API search.list: returns the given ids for any query. */
export function serveSearchApi(web: FakeWeb, ids: string[]): void {
  web.on('https://www.googleapis.com/youtube/v3/search', () => Response.json({items: ids.map(videoId => ({id: {kind: 'youtube#video', videoId}}))}));
}

/**
 * Data API playlistItems.list for the example channel: the feed fixture's videos as
 * uploads, and those the feed links as Shorts in the `UUSH` playlist.
 */
export async function serveUploadsApi(web: FakeWeb): Promise<void> {
  const entries = parseUploadsFeed(await fixture('youtube-feed.xml')).entries;
  const resource = (e: (typeof entries)[number]) => ({
    snippet: {title: e.title, channelId: CHANNEL, channelTitle: 'Example Workshop', videoOwnerChannelId: CHANNEL, videoOwnerChannelTitle: 'Example Workshop', resourceId: {videoId: e.external_id}, thumbnails: {medium: {url: e.thumbnail}}},
    contentDetails: {videoId: e.external_id, videoPublishedAt: e.published},
  });
  web.on('https://www.googleapis.com/youtube/v3/playlistItems', url => {
    const playlist = url.searchParams.get('playlistId');
    if (playlist === `UU${CHANNEL.slice(2)}`) return Response.json({items: entries.map(resource)});
    if (playlist === `UUSH${CHANNEL.slice(2)}`) return Response.json({items: entries.filter(e => e.extra?.['short'] === true).map(resource)});
    return Response.json({error: {code: 404}}, {status: 404});
  });
}
