/**
 * Papers, fetched by the app: Semantic Scholar for search, lookups, recommendations and
 * author feeds (free; a key raises rate limits), arXiv for category feeds.
 */
import {AppError, EXIT_ERROR, EXIT_NOT_FOUND, EXIT_USAGE, usageError} from '../core/errors.ts';
import {S2_FIELDS, paperFromS2, parseArxivCategory, parseArxivFeed, parseAuthorRef, parsePaperRef} from '../core/papers.ts';
import type {Follow, FollowCandidate, ItemInput} from '../core/types.ts';
import type {SearchOpts, Source, SourceDeps} from './types.ts';

const S2 = 'https://api.semanticscholar.org';
const ARXIV = 'https://export.arxiv.org/api/query';
const ARXIV_INTERVAL_MS = 3000;

export function papersSource(deps: SourceDeps): Source {
  const headers = (): Record<string, string> => {
    const key = deps.setting('semantic_scholar_api_key');
    return key === undefined ? {} : {'x-api-key': key};
  };

  async function request(url: string, what: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await deps.fetcher(url, {...init, headers: {...headers(), ...(init.headers as Record<string, string> | undefined)}});
    } catch (error) {
      throw new AppError(`could not reach ${what}: ${error instanceof Error ? error.message : String(error)}`, EXIT_ERROR);
    }
    if (response.status === 404) throw new AppError(`${what}: not found`, EXIT_NOT_FOUND);
    if (response.status === 429) throw new AppError(`${what} is rate limiting us; try again shortly${deps.setting('semantic_scholar_api_key') === undefined ? ' (a semantic_scholar_api_key raises the limit)' : ''}`, EXIT_ERROR);
    if (!response.ok) throw new AppError(`${what} answered ${response.status}`, EXIT_ERROR, {status: response.status});
    return response;
  }

  const s2 = async (path: string, init?: RequestInit) => (await (await request(`${S2}${path}`, 'Semantic Scholar', init)).json()) as Record<string, any>;

  const papers = (records: unknown): ItemInput[] =>
    ((Array.isArray(records) ? records : []) as Array<Record<string, any> | null>).flatMap(r => {
      const item = r === null ? undefined : paperFromS2(r);
      return item === undefined ? [] : [item];
    });

  /** S2 records for refs (ARXIV:…, DOI:…, paper ids), in order; unknown ones are skipped. */
  async function batch(refs: string[]): Promise<ItemInput[]> {
    if (refs.length === 0) return [];
    const found: ItemInput[] = [];
    for (let i = 0; i < refs.length; i += 400) {
      const body = await request(`${S2}/graph/v1/paper/batch?fields=${S2_FIELDS}`, 'Semantic Scholar', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({ids: refs.slice(i, i + 400)}),
      });
      found.push(...papers(await body.json()));
    }
    return found;
  }

  async function arxiv(query: URLSearchParams): Promise<string> {
    await deps.gate('arxiv', ARXIV_INTERVAL_MS);
    return (await request(`${ARXIV}?${query}`, 'arXiv')).text();
  }

  const minYear = () => Number(deps.setting('papers_min_year') ?? new Date(deps.now()).getFullYear() - 5);

  return {
    id: 'papers',
    label: {done: 'Read', item: 'paper', name: 'Papers'},
    followKinds: ['author', 'category', 'query'],
    fetchedBy: 'app',

    parseRef(input) {
      const ref = parsePaperRef(input);
      return ref === undefined ? null : {externalId: ref};
    },

    async resolveFollow(input, kind): Promise<FollowCandidate> {
      const chosen = kind ?? (parseAuthorRef(input) !== undefined && /semanticscholar|^\d+$/.test(input.trim()) ? 'author' : parseArxivCategory(input) !== undefined && /arxiv\.org\/list|^[a-z-]+\.[A-Za-z-]+$/.test(input.trim()) ? 'category' : 'query');
      if (chosen === 'author') {
        const id = parseAuthorRef(input);
        if (id !== undefined) {
          const author = await s2(`/graph/v1/author/${id}?fields=name,url`);
          return {kind: 'author', external_id: id, title: String(author['name'] ?? id), url: typeof author['url'] === 'string' ? author['url'] : `https://www.semanticscholar.org/author/${id}`};
        }
        const found = await s2(`/graph/v1/author/search?query=${encodeURIComponent(input.trim())}&fields=name,affiliations,paperCount&limit=10`);
        const candidates = ((found['data'] ?? []) as Array<Record<string, any>>).map(a => `${a['authorId']}  ${a['name']}${(a['affiliations'] ?? []).length > 0 ? ` (${(a['affiliations'] as string[]).join(', ')})` : ''}, ${a['paperCount'] ?? '?'} papers`);
        if (candidates.length === 0) throw new AppError(`no Semantic Scholar author matches "${input}"`, EXIT_NOT_FOUND);
        throw new AppError(`which "${input}"? follow one by id: legenda follow papers <author-id> --kind author`, EXIT_USAGE, {candidates});
      }
      if (chosen === 'category') {
        const category = parseArxivCategory(input);
        if (category === undefined) throw usageError(`not an arXiv category: ${input} (like cs.DC)`);
        return {kind: 'category', external_id: category, title: `arXiv ${category}`, url: `https://arxiv.org/list/${category}/recent`};
      }
      if (chosen === 'query') {
        const query = input.trim();
        if (query === '') throw usageError('a query follow needs a search string');
        return {kind: 'query', external_id: query, title: query, url: null};
      }
      throw usageError(`paper follows are author, category or query, not "${chosen}"`);
    },

    async poll(follow: Follow) {
      if (follow.kind === 'author') {
        const body = await s2(`/graph/v1/author/${follow.external_id}/papers?fields=${S2_FIELDS}&limit=100`);
        return papers(body['data']);
      }
      if (follow.kind === 'category') {
        const xml = await arxiv(new URLSearchParams({search_query: `cat:${follow.external_id}`, sortBy: 'submittedDate', sortOrder: 'descending', max_results: '50'}));
        const entries = parseArxivFeed(xml);
        // Name them by Semantic Scholar id where S2 knows them already; brand-new ones keep their arXiv id.
        let resolved = new Map<string, ItemInput>();
        try {
          resolved = new Map((await batch(entries.map(e => `ARXIV:${e.arxivId}`))).map(p => [String(p.extra?.['arxiv_id']), p]));
        } catch {
          // S2 unavailable: arXiv ids alone still dedup through refs.
        }
        return entries.map(({arxivId, item}) => {
          const s2 = resolved.get(arxivId);
          if (s2 === undefined) return item;
          return {...item, external_id: s2.external_id, creator_external_id: s2.creator_external_id ?? null, container: s2.container ?? item.container, extra: {...item.extra, ...s2.extra, refs: [...new Set([...((s2.extra?.['refs'] as string[]) ?? []), ...((item.extra?.['refs'] as string[]) ?? [])])]}};
        });
      }
      const body = await s2(`/graph/v1/paper/search?query=${encodeURIComponent(follow.external_id)}&fields=${S2_FIELDS}&limit=50&year=${minYear()}-`);
      return papers(body['data']);
    },

    async search(query: string, opts: SearchOpts) {
      const params = new URLSearchParams({query, fields: S2_FIELDS, limit: String(Math.min(100, Math.max(1, opts.max ?? 20)))});
      if (opts.yearFrom !== undefined) params.set('year', `${opts.yearFrom}-`);
      return papers((await s2(`/graph/v1/paper/search?${params}`))['data']);
    },

    async details(refs) {
      const parsed = [...new Set(refs.map(r => parsePaperRef(r)).filter((r): r is string => r !== undefined))];
      return batch(parsed);
    },

    async recommend(positive, negative, max) {
      const body = await s2(`/recommendations/v1/papers?fields=${S2_FIELDS}&limit=${Math.min(100, Math.max(1, max))}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({positivePaperIds: positive.filter(id => /^[0-9a-f]{40}$/.test(id)), negativePaperIds: negative.filter(id => /^[0-9a-f]{40}$/.test(id))}),
      });
      return papers(body['recommendedPapers']);
    },
  };
}
