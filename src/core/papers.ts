/**
 * Papers, pure: references, Semantic Scholar records and arXiv Atom entries.
 *
 * A paper can be named many ways — an arXiv id, a DOI, a Semantic Scholar URL. The item's
 * `external_id` is its Semantic Scholar paper id; every other way of naming it is kept in
 * `extra.refs` (`ARXIV:2401.01234`, `DOI:10.1145/…`), so the same paper arriving by a
 * different name is still one item.
 */
import {normalizeIso} from './time.ts';
import type {ItemInput} from './types.ts';
import {attr, elements, tagsWithAttrs, text} from './xml.ts';

const NEW_ARXIV = /^(\d{4}\.\d{4,5})(v\d+)?$/;
const OLD_ARXIV = /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?$/;
const S2_ID = /^[0-9a-f]{40}$/;
const DOI = /^10\.\d{4,9}\/\S+$/i;

/** A paper reference in the form Semantic Scholar's API takes, or undefined. */
export function parsePaperRef(input: string): string | undefined {
  let text = input.trim();
  if (text === '') return undefined;

  const prefixed = /^(arxiv|doi|corpusid)\s*:\s*(.+)$/i.exec(text);
  if (prefixed !== null) {
    const [, kind, rest] = prefixed;
    if (kind!.toLowerCase() === 'arxiv') return arxivRef(rest!);
    if (kind!.toLowerCase() === 'doi') return DOI.test(rest!.trim()) ? `DOI:${rest!.trim().toLowerCase()}` : undefined;
    return /^\d+$/.test(rest!.trim()) ? `CorpusId:${rest!.trim()}` : undefined;
  }
  if (S2_ID.test(text)) return text;
  if (DOI.test(text)) return `DOI:${text.toLowerCase()}`;
  const bareArxiv = arxivRef(text);
  if (bareArxiv !== undefined) return bareArxiv;

  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = decodeURIComponent(url.pathname);
  if (host === 'arxiv.org' || host === 'export.arxiv.org') {
    const match = /^\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/.exec(path);
    return match === null ? undefined : arxivRef(match[1]!);
  }
  if (host === 'doi.org' || host === 'dx.doi.org') {
    const doi = path.slice(1);
    return DOI.test(doi) ? `DOI:${doi.toLowerCase()}` : undefined;
  }
  if (host === 'semanticscholar.org' || host === 'api.semanticscholar.org') {
    const match = /\/paper\/(?:[^/]+\/)?([0-9a-f]{40})\/?$/.exec(path);
    if (match !== null) return match[1];
    const corpus = /\/CorpusID:(\d+)/i.exec(path);
    return corpus === null ? undefined : `CorpusId:${corpus[1]}`;
  }
  return undefined;
}

function arxivRef(id: string): string | undefined {
  const trimmed = id.trim();
  const match = NEW_ARXIV.exec(trimmed) ?? OLD_ARXIV.exec(trimmed);
  return match === null ? undefined : `ARXIV:${match[1]}`;
}

export const arxivAbsUrl = (id: string) => `https://arxiv.org/abs/${id}`;

/** Reading time from a page count, at about four minutes a page. */
export const minutesFromPages = (pages: number | undefined): number | null => (pages === undefined || pages <= 0 ? null : pages * 4);

/** "12 pages, 5 figures" → 12. */
export function pagesFromComment(comment: string | undefined): number | undefined {
  const match = /(\d+)\s*pages?/i.exec(comment ?? '');
  return match === null ? undefined : Number(match[1]);
}

export const S2_FIELDS = 'paperId,externalIds,url,title,abstract,venue,year,publicationDate,authors,openAccessPdf,citationCount';

type Json = Record<string, any>;

function creatorOf(names: string[]): string {
  if (names.length === 0) return '';
  return names.length === 1 ? names[0]! : `${names[0]} et al.`;
}

/** A Semantic Scholar paper record → an item. */
export function paperFromS2(record: Json): ItemInput | undefined {
  const id = record['paperId'];
  if (typeof id !== 'string' || id === '') return undefined;
  const ids = (record['externalIds'] ?? {}) as Json;
  const arxiv = typeof ids['ArXiv'] === 'string' ? ids['ArXiv'] : undefined;
  const doi = typeof ids['DOI'] === 'string' ? ids['DOI'].toLowerCase() : undefined;
  const authors = ((record['authors'] ?? []) as Json[]).filter(a => typeof a['name'] === 'string');
  const s2Url = typeof record['url'] === 'string' ? record['url'] : `https://www.semanticscholar.org/paper/${id}`;
  const pdf = record['openAccessPdf']?.['url'];
  const year = typeof record['year'] === 'number' ? record['year'] : undefined;
  const refs = [...(arxiv ? [`ARXIV:${arxiv}`] : []), ...(doi ? [`DOI:${doi}`] : []), ...(ids['CorpusId'] ? [`CorpusId:${ids['CorpusId']}`] : [])];
  return {
    source: 'papers',
    external_id: id,
    url: arxiv ? arxivAbsUrl(arxiv) : doi ? `https://doi.org/${doi}` : s2Url,
    title: String(record['title'] ?? '').trim(),
    creator: creatorOf(authors.map(a => a['name'] as string)),
    creator_external_id: typeof authors[0]?.['authorId'] === 'string' ? authors[0]!['authorId'] : null,
    container: typeof record['venue'] === 'string' && record['venue'] !== '' ? record['venue'] : arxiv ? 'arXiv' : null,
    published: normalizeIso(record['publicationDate']) ?? (year === undefined ? null : `${year}-01-01T00:00:00Z`),
    length_minutes: null,
    abstract: typeof record['abstract'] === 'string' ? record['abstract'].trim() : null,
    extra: {
      refs,
      ...(arxiv ? {arxiv_id: arxiv} : {}),
      ...(doi ? {doi} : {}),
      s2_url: s2Url,
      ...(typeof pdf === 'string' && pdf !== '' ? {pdf_url: pdf} : {}),
      ...(typeof record['citationCount'] === 'number' ? {citation_count: record['citationCount']} : {}),
      authors: authors.map(a => a['name']).slice(0, 20),
    },
  };
}

export interface ArxivEntry {
  arxivId: string;
  item: ItemInput;
}

/** An arXiv API Atom feed → entries, keyed by arXiv id; external_id is `ARXIV:<id>` until resolved. */
export function parseArxivFeed(xml: string): ArxivEntry[] {
  const out: ArxivEntry[] = [];
  for (const entry of elements(xml, 'entry')) {
    const idUrl = text(entry, 'id') ?? '';
    const match = /arxiv\.org\/abs\/(.+?)(v\d+)?$/.exec(idUrl);
    if (match === null) continue;
    const arxivId = match[1]!;
    const authors = elements(entry, 'author').map(a => text(a, 'name') ?? '').filter(Boolean);
    const pages = pagesFromComment(text(entry, 'arxiv:comment'));
    const doi = text(entry, 'arxiv:doi')?.toLowerCase();
    const pdf = tagsWithAttrs(entry, 'link').find(l => l['title'] === 'pdf')?.['href'];
    out.push({
      arxivId,
      item: {
        source: 'papers',
        external_id: `ARXIV:${arxivId}`,
        url: arxivAbsUrl(arxivId),
        title: text(entry, 'title') ?? '',
        creator: creatorOf(authors),
        creator_external_id: null,
        container: attr(entry, 'arxiv:primary_category', 'term') ?? 'arXiv',
        published: normalizeIso(text(entry, 'published')) ?? null,
        length_minutes: minutesFromPages(pages),
        abstract: text(entry, 'summary') ?? null,
        extra: {refs: [`ARXIV:${arxivId}`, ...(doi ? [`DOI:${doi}`] : [])], arxiv_id: arxivId, ...(doi ? {doi} : {}), ...(pdf ? {pdf_url: pdf} : {}), authors: authors.slice(0, 20), ...(pages ? {pages} : {})},
      },
    });
  }
  return out;
}

/** An arXiv category, from `cs.DC` or an arxiv.org/list URL. */
export function parseArxivCategory(input: string): string | undefined {
  const text = input.trim();
  const fromUrl = /arxiv\.org\/list\/([^/?#]+)/i.exec(text);
  const candidate = fromUrl === null ? text : fromUrl[1]!;
  return /^[a-z-]+(\.[A-Za-z-]+)?$/.test(candidate) ? candidate : undefined;
}

/** A Semantic Scholar author id, from a URL or a bare number. */
export function parseAuthorRef(input: string): string | undefined {
  const text = input.trim();
  if (/^\d+$/.test(text)) return text;
  const match = /semanticscholar\.org\/author\/(?:[^/]+\/)?(\d+)/i.exec(text);
  return match === null ? undefined : match[1];
}
