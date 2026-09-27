/** Fixture responses for the YouTube endpoints the adapter calls. */
import type {FakeWeb} from './fakeWeb.ts';
import {fixture} from './fakeWeb.ts';

export const CHANNEL = 'UCexampleChannel0000000A';
export const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;

export async function serveChannel(web: FakeWeb): Promise<void> {
  web.on(FEED, await fixture('youtube-feed.xml'));
  web.on('https://www.youtube.com/@exampleworkshop', `<html><link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL}"></html>`);
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
