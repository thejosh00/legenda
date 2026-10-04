/**
 * YouTube references, pure: which video or channel a pasted string points at.
 */
import {attr, elements, text} from './xml.ts';
import {normalizeIso} from './time.ts';
import type {ItemInput} from './types.ts';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

function asUrl(input: string): URL | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;
  try {
    return new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }
}

/** The 11-character video id in any of the URL forms people paste, or a bare id. */
export function parseVideoRef(input: string): string | undefined {
  const trimmed = input.trim();
  if (VIDEO_ID.test(trimmed)) return trimmed;

  const url = asUrl(trimmed);
  if (url === undefined) return undefined;
  const host = url.hostname.toLowerCase();

  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1] ?? '';
    return VIDEO_ID.test(id) ? id : undefined;
  }
  if (!HOSTS.has(host)) return undefined;

  if (url.pathname === '/watch') {
    const id = url.searchParams.get('v') ?? '';
    return VIDEO_ID.test(id) ? id : undefined;
  }
  const match = /^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/.exec(url.pathname);
  return match !== null && VIDEO_ID.test(match[1]!) ? match[1] : undefined;
}

export const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const channelUrl = (id: string) => `https://www.youtube.com/channel/${id}`;

export type ChannelRef = {kind: 'id'; id: string} | {kind: 'handle'; handle: string} | {kind: 'legacy'; path: string};

/** A channel URL, `@handle` or `UC…` id. Video URLs are not channel refs. */
export function parseChannelRef(input: string): ChannelRef | undefined {
  const trimmed = input.trim();
  if (CHANNEL_ID.test(trimmed)) return {kind: 'id', id: trimmed};
  if (/^@[\w.-]{2,}$/.test(trimmed)) return {kind: 'handle', handle: trimmed.slice(1)};

  const url = asUrl(trimmed);
  if (url === undefined || !HOSTS.has(url.hostname.toLowerCase())) return undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  const [first, second] = parts;
  if (first === undefined) return undefined;
  if (first === 'channel' && second !== undefined && CHANNEL_ID.test(second)) return {kind: 'id', id: second};
  if (first.startsWith('@') && first.length > 2) return {kind: 'handle', handle: decodeURIComponent(first.slice(1))};
  if ((first === 'c' || first === 'user') && second !== undefined) return {kind: 'legacy', path: `/${first}/${second}`};
  return undefined;
}

/** The channel id embedded in a channel or video page's HTML, best effort. */
export function channelIdFromHtml(html: string): string | undefined {
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})"/,
    /"externalId":"(UC[A-Za-z0-9_-]{22})"/,
    /"channelId":"(UC[A-Za-z0-9_-]{22})"/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match !== null) return match[1];
  }
  return undefined;
}

/** The channel's name from its page's og:title, best effort. */
export function channelTitleFromHtml(html: string): string | undefined {
  const match = /<meta property="og:title" content="([^"]*)"/.exec(html);
  return match === null ? undefined : decodeEntities(match[1]!).trim() || undefined;
}

const decodeEntities = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// --- feeds and API responses ---------------------------------------------------------


export const feedUrl = (channelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

export interface ParsedFeed {
  channelId: string | undefined;
  title: string | undefined;
  entries: ItemInput[];
}

/** A channel's uploads feed: newest ~15 videos, no durations. */
export function parseUploadsFeed(xml: string): ParsedFeed {
  const channelId = text(xml.split('<entry')[0] ?? xml, 'yt:channelId');
  const author = text(xml.split('<entry')[0] ?? xml, 'name');
  const feedTitle = text(xml.split('<entry')[0] ?? xml, 'title');
  const entries: ItemInput[] = [];
  for (const entry of elements(xml, 'entry')) {
    const id = text(entry, 'yt:videoId');
    if (id === undefined || !/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
    const creator = text(entry, 'name') ?? author ?? '';
    const entryChannel = text(entry, 'yt:channelId') ?? channelId;
    const description = text(entry, 'media:description');
    // The feed links Shorts as /shorts/<id>: the one way to spot them without a key.
    const short = /\/shorts\//.test(attr(entry, 'link', 'href') ?? '');
    entries.push({
      source: 'youtube',
      external_id: id,
      url: videoUrl(id),
      title: text(entry, 'title') ?? '',
      creator,
      creator_external_id: entryChannel ?? null,
      published: normalizeIso(text(entry, 'published')) ?? null,
      thumbnail: attr(entry, 'media:thumbnail', 'url') ?? null,
      extra: {
        ...(description === undefined || description === '' ? {} : {description: description.slice(0, 500)}),
        ...(short ? {short: true} : {}),
      },
    });
  }
  return {channelId, title: author ?? feedTitle, entries};
}

/** ISO-8601 duration (`PT1H2M3S`, `P1DT2H`) → seconds; undefined if not one. */
export function durationSeconds(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (match === null) return undefined;
  const [, d, h, m, s] = match;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

export const minutesFromSeconds = (seconds: number | undefined): number | null =>
  seconds === undefined ? null : Math.max(1, Math.round(seconds / 60));

type Json = Record<string, any>;

/** One `videos.list` resource (snippet + contentDetails) → an item. */
export function videoFromApi(resource: Json): ItemInput | undefined {
  const id = resource['id'];
  const snippet = resource['snippet'] as Json | undefined;
  if (typeof id !== 'string' || snippet === undefined) return undefined;
  const seconds = durationSeconds(resource['contentDetails']?.['duration']);
  const thumbs = snippet['thumbnails'] as Json | undefined;
  const thumb = thumbs?.['medium']?.['url'] ?? thumbs?.['high']?.['url'] ?? thumbs?.['default']?.['url'];
  const live = snippet['liveBroadcastContent'];
  return {
    source: 'youtube',
    external_id: id,
    url: videoUrl(id),
    title: String(snippet['title'] ?? ''),
    creator: String(snippet['channelTitle'] ?? ''),
    creator_external_id: typeof snippet['channelId'] === 'string' ? snippet['channelId'] : null,
    published: normalizeIso(snippet['publishedAt']) ?? null,
    length_minutes: minutesFromSeconds(seconds),
    thumbnail: typeof thumb === 'string' ? thumb : null,
    extra: {
      ...(seconds === undefined ? {} : {duration_seconds: seconds}),
      ...(typeof live === 'string' && live !== 'none' ? {live} : {}),
      ...(typeof snippet['description'] === 'string' && snippet['description'] !== '' ? {description: snippet['description'].slice(0, 500)} : {}),
    },
  };
}

/**
 * One `playlistItems.list` resource from a channel's uploads playlist (snippet +
 * contentDetails) → an item without duration. Private and deleted videos, which have
 * no publication time, are skipped.
 */
export function videoFromPlaylistItem(resource: Json): ItemInput | undefined {
  const snippet = resource['snippet'] as Json | undefined;
  const id = resource['contentDetails']?.['videoId'] ?? snippet?.['resourceId']?.['videoId'];
  const published = normalizeIso(resource['contentDetails']?.['videoPublishedAt']);
  if (typeof id !== 'string' || snippet === undefined || published === undefined) return undefined;
  const thumbs = snippet['thumbnails'] as Json | undefined;
  const thumb = thumbs?.['medium']?.['url'] ?? thumbs?.['high']?.['url'] ?? thumbs?.['default']?.['url'];
  const channelId = snippet['videoOwnerChannelId'] ?? snippet['channelId'];
  return {
    source: 'youtube',
    external_id: id,
    url: videoUrl(id),
    title: String(snippet['title'] ?? ''),
    creator: String(snippet['videoOwnerChannelTitle'] ?? snippet['channelTitle'] ?? ''),
    creator_external_id: typeof channelId === 'string' ? channelId : null,
    published,
    thumbnail: typeof thumb === 'string' ? thumb : null,
    extra: typeof snippet['description'] === 'string' && snippet['description'] !== '' ? {description: snippet['description'].slice(0, 500)} : {},
  };
}

/** A channel's uploads playlist: the channel id with `UC` swapped for `UU`. */
export const uploadsPlaylist = (channelId: string) => `UU${channelId.slice(2)}`;
/** The same, Shorts only (`UUSH`); YouTube answers 404 when a channel has none. */
export const shortsPlaylist = (channelId: string) => `UUSH${channelId.slice(2)}`;

/** The key-free oEmbed answer → an item without duration or channel id. */
export function videoFromOembed(id: string, body: Json): ItemInput {
  const authorUrl = typeof body['author_url'] === 'string' ? body['author_url'] : undefined;
  const channel = authorUrl === undefined ? undefined : parseChannelRef(authorUrl);
  return {
    source: 'youtube',
    external_id: id,
    url: videoUrl(id),
    title: String(body['title'] ?? ''),
    creator: String(body['author_name'] ?? ''),
    creator_external_id: channel?.kind === 'id' ? channel.id : null,
    length_minutes: null,
    thumbnail: typeof body['thumbnail_url'] === 'string' ? body['thumbnail_url'] : null,
    extra: authorUrl === undefined ? {} : {channel_url: authorUrl},
  };
}

/** Shorts are ≤ 60 s; only knowable with a duration. */
export const isShort = (item: ItemInput): boolean => {
  if (item.extra?.['short'] === true) return true;
  const seconds = item.extra?.['duration_seconds'];
  return typeof seconds === 'number' && seconds > 0 && seconds <= 60;
};
