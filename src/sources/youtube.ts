/**
 * YouTube, fetched by the app.
 *
 * Channel follows are polled from their public Atom feeds, which need no key. Search
 * and durations use the Data API v3 when `youtube_api_key` is set, spending units from
 * the daily budget. Without a key the source still works, with less: details come from
 * oEmbed (no duration), and search says plainly that it needs a key.
 */
import {AppError, EXIT_ERROR, usageError} from '../core/errors.ts';
import type {Follow, FollowCandidate, ItemInput} from '../core/types.ts';
import {
  channelIdFromHtml,
  channelUrl,
  feedUrl,
  parseChannelRef,
  parseUploadsFeed,
  parseVideoRef,
  videoFromApi,
  videoFromOembed,
  videoUrl,
} from '../core/youtube.ts';
import type {SearchOpts, Source, SourceDeps} from './types.ts';

const API = 'https://www.googleapis.com/youtube/v3';
const UNITS = {search: 100, videos: 1, channels: 1};

export function youtubeSource(deps: SourceDeps): Source {
  const key = () => deps.setting('youtube_api_key');

  async function get(url: string, what: string): Promise<Response> {
    let response: Response;
    try {
      response = await deps.fetcher(url, {headers: {'accept-language': 'en'}});
    } catch (error) {
      throw new AppError(`could not reach YouTube for ${what}: ${error instanceof Error ? error.message : String(error)}`, EXIT_ERROR);
    }
    if (!response.ok) throw new AppError(`YouTube answered ${response.status} for ${what}`, EXIT_ERROR, {status: response.status});
    return response;
  }

  async function api(path: string, params: Record<string, string>, units: number): Promise<Record<string, any>> {
    const apiKey = key();
    if (apiKey === undefined) throw new AppError('no YouTube API key is set (legenda settings set youtube_api_key …)', EXIT_ERROR);
    deps.spend(units);
    const query = new URLSearchParams({...params, key: apiKey});
    return (await (await get(`${API}/${path}?${query}`, path)).json()) as Record<string, any>;
  }

  async function feed(channelId: string) {
    return parseUploadsFeed(await (await get(feedUrl(channelId), `channel ${channelId}`)).text());
  }

  async function channelFromId(channelId: string): Promise<FollowCandidate> {
    const parsed = await feed(channelId);
    return {kind: 'channel', external_id: channelId, title: parsed.title ?? channelId, url: channelUrl(channelId)};
  }

  async function channelFromPage(url: string): Promise<FollowCandidate> {
    const html = await (await get(url, 'the channel page')).text();
    const id = channelIdFromHtml(html);
    if (id === undefined) throw new AppError(`could not find a channel id on ${url}`, EXIT_ERROR);
    return channelFromId(id);
  }

  async function videosByApi(ids: string[]): Promise<ItemInput[]> {
    const found: ItemInput[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const body = await api('videos', {part: 'snippet,contentDetails', id: batch.join(','), maxResults: '50'}, UNITS.videos);
      for (const resource of (body['items'] ?? []) as Array<Record<string, any>>) {
        const item = videoFromApi(resource);
        if (item !== undefined) found.push(item);
      }
    }
    return found;
  }

  async function videoByOembed(id: string): Promise<ItemInput | undefined> {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl(id))}&format=json`;
    let response: Response;
    try {
      response = await deps.fetcher(url);
    } catch {
      return undefined;
    }
    if (!response.ok) return undefined;
    return videoFromOembed(id, (await response.json()) as Record<string, any>);
  }

  return {
    id: 'youtube',
    label: {done: 'Watched', item: 'video', name: 'YouTube'},
    followKinds: ['channel'],
    fetchedBy: 'app',

    parseRef(input) {
      const id = parseVideoRef(input);
      return id === undefined ? null : {externalId: id};
    },
    canonicalUrl: videoUrl,

    async resolveFollow(input) {
      const channel = parseChannelRef(input);
      if (channel?.kind === 'id') return channelFromId(channel.id);
      if (channel?.kind === 'handle') {
        if (key() !== undefined) {
          const body = await api('channels', {part: 'snippet', forHandle: `@${channel.handle}`}, UNITS.channels);
          const found = (body['items'] ?? [])[0] as Record<string, any> | undefined;
          if (found === undefined) throw new AppError(`no YouTube channel @${channel.handle}`, 3);
          return {kind: 'channel', external_id: String(found['id']), title: String(found['snippet']?.['title'] ?? channel.handle), url: channelUrl(String(found['id']))};
        }
        return channelFromPage(`https://www.youtube.com/@${encodeURIComponent(channel.handle)}`);
      }
      if (channel?.kind === 'legacy') return channelFromPage(`https://www.youtube.com${channel.path}`);

      const video = parseVideoRef(input);
      if (video !== undefined) {
        const [item] = key() !== undefined ? await videosByApi([video]) : [await videoByOembed(video)];
        if (item === undefined) throw new AppError(`could not look up video ${video}`, EXIT_ERROR);
        if (item.creator_external_id) return channelFromId(item.creator_external_id);
        const channelPage = item.extra?.['channel_url'];
        if (typeof channelPage === 'string') return channelFromPage(channelPage);
        throw new AppError(`could not tell which channel posted ${video}`, EXIT_ERROR);
      }
      throw usageError(`not a YouTube channel: ${input} (paste a channel URL, @handle, UC… id, or a video URL)`);
    },

    async poll(follow: Follow) {
      return (await feed(follow.external_id)).entries;
    },

    async details(refs) {
      const ids = [...new Set(refs.map(r => parseVideoRef(r)).filter((id): id is string => id !== undefined))];
      if (ids.length === 0) return [];
      if (key() !== undefined) return videosByApi(ids);
      const found: ItemInput[] = [];
      for (const id of ids) {
        const item = await videoByOembed(id);
        if (item !== undefined) found.push(item);
      }
      return found;
    },

    async search(query: string, opts: SearchOpts) {
      const params: Record<string, string> = {part: 'snippet', type: 'video', q: query, maxResults: String(Math.min(50, Math.max(1, opts.max ?? 10)))};
      if (opts.publishedAfter !== undefined) params['publishedAfter'] = opts.publishedAfter;
      if (opts.duration !== undefined) params['videoDuration'] = opts.duration;
      const body = await api('search', params, UNITS.search);
      const ids = ((body['items'] ?? []) as Array<Record<string, any>>)
        .map(r => r['id']?.['videoId'])
        .filter((id): id is string => typeof id === 'string');
      if (ids.length === 0) return [];
      // Search results lack durations; one more unit fetches them for all.
      const detailed = await videosByApi(ids);
      const order = new Map(ids.map((id, i) => [id, i]));
      return detailed.sort((a, b) => (order.get(a.external_id) ?? 0) - (order.get(b.external_id) ?? 0));
    },
  };
}
