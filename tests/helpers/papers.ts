/** Fixture Semantic Scholar and arXiv endpoints. */
import type {FakeWeb} from './fakeWeb.ts';
import {fixture} from './fakeWeb.ts';

export const RAFT = 'a'.repeat(40);
export const RAFT_ARXIV = '1401.00001';
export const RAFT_DOI = '10.5555/raft.2014';

export interface PaperSpec {
  id: string;
  title: string;
  arxiv?: string;
  doi?: string;
  authors?: Array<[string, string]>;
  date?: string;
}

export const paper = (spec: PaperSpec) => ({
  paperId: spec.id,
  externalIds: {...(spec.arxiv ? {ArXiv: spec.arxiv} : {}), ...(spec.doi ? {DOI: spec.doi} : {}), CorpusId: parseInt(spec.id.slice(0, 6), 16)},
  url: `https://www.semanticscholar.org/paper/${spec.id}`,
  title: spec.title,
  abstract: `Abstract of ${spec.title}.`,
  venue: 'USENIX ATC',
  year: Number((spec.date ?? '2014').slice(0, 4)),
  publicationDate: spec.date ?? '2014-06-19',
  authors: (spec.authors ?? [['1001', 'Diego Ongaro'], ['1002', 'John Ousterhout']]).map(([authorId, name]) => ({authorId, name})),
  openAccessPdf: {url: `https://example.org/${spec.id}.pdf`},
  citationCount: 42,
});

export const PAPERS: PaperSpec[] = [
  {id: RAFT, title: 'In Search of an Understandable Consensus Algorithm', arxiv: RAFT_ARXIV, doi: RAFT_DOI},
  {id: 'b'.repeat(40), title: 'Paxos Made Simple', authors: [['2001', 'Leslie Lamport']], date: '2001-11-01'},
  {id: 'c'.repeat(40), title: 'Leaderless Replication with Bounded Staleness', arxiv: '2609.01002', authors: [['3001', 'Ada Example']], date: '2026-09-11'},
  // The one the agent contract's examples name.
  {id: 'e'.repeat(40), title: 'Raft Membership Changes, Revisited', arxiv: '2401.01234', authors: [['1001', 'Diego Ongaro']], date: '2024-01-03'},
];

function lookup(ref: string): PaperSpec | undefined {
  const r = ref.toLowerCase();
  return PAPERS.find(p => p.id === ref || (p.arxiv && r === `arxiv:${p.arxiv}`) || (p.doi && r === `doi:${p.doi.toLowerCase()}`));
}

export async function serveS2(web: FakeWeb): Promise<void> {
  web.on('https://api.semanticscholar.org/graph/v1/paper/batch', (_url, init) => {
    const ids = (JSON.parse(String(init?.body)) as {ids: string[]}).ids;
    return Response.json(ids.map(ref => (lookup(ref) ? paper(lookup(ref)!) : null)));
  });
  web.on('https://api.semanticscholar.org/graph/v1/paper/search', () => Response.json({total: 2, data: [paper(PAPERS[1]!), paper(PAPERS[0]!)]}));
  web.on('https://api.semanticscholar.org/graph/v1/author/1001/papers', () => Response.json({data: [paper(PAPERS[0]!), paper({id: 'd'.repeat(40), title: 'Raft Refloated', date: '2015-01-01'})]}));
  web.on('https://api.semanticscholar.org/graph/v1/author/1001?', () => Response.json({authorId: '1001', name: 'Diego Ongaro', url: 'https://www.semanticscholar.org/author/1001'}));
  web.on('https://api.semanticscholar.org/graph/v1/author/search', () =>
    Response.json({data: [{authorId: '1001', name: 'Diego Ongaro', affiliations: ['Stanford'], paperCount: 12}, {authorId: '9', name: 'D. Ongaro', affiliations: [], paperCount: 1}]}),
  );
  web.on('https://api.semanticscholar.org/recommendations/v1/papers', () => Response.json({recommendedPapers: [paper(PAPERS[2]!)]}));
  web.on('https://export.arxiv.org/api/query', await fixture('arxiv-cs-dc.xml'));
}
