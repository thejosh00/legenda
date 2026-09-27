import {describe, expect, test} from 'bun:test';
import {pagesFromComment, paperFromS2, parseArxivCategory, parseArxivFeed, parseAuthorRef, parsePaperRef} from '../../src/core/papers.ts';
import {fixture} from '../helpers/fakeWeb.ts';
import {paper, PAPERS, RAFT} from '../helpers/papers.ts';

describe('paper refs', () => {
  test.each([
    ['arXiv:2401.01234', 'ARXIV:2401.01234'],
    ['2401.01234v3', 'ARXIV:2401.01234'],
    ['https://arxiv.org/abs/2401.01234v2', 'ARXIV:2401.01234'],
    ['https://arxiv.org/pdf/2401.01234.pdf', 'ARXIV:2401.01234'],
    ['arxiv.org/abs/cs/0112017', 'ARXIV:cs/0112017'],
    ['10.1145/3132747.3132757', 'DOI:10.1145/3132747.3132757'],
    ['https://doi.org/10.1145/ABC.123', 'DOI:10.1145/abc.123'],
    ['doi:10.1145/abc', 'DOI:10.1145/abc'],
    [`https://www.semanticscholar.org/paper/In-Search-of-Raft/${RAFT}`, RAFT],
    [RAFT, RAFT],
    ['https://www.semanticscholar.org/paper/CorpusID:1234', 'CorpusId:1234'],
  ])('%s', (input, ref) => {
    expect(parsePaperRef(input)).toBe(ref);
  });

  test.each([['https://youtu.be/abcdefghijk'], ['hello world'], ['https://arxiv.org/list/cs.DC/recent']])('rejects %s', input => {
    expect(parsePaperRef(input)).toBeUndefined();
  });

  test('categories and authors', () => {
    expect(parseArxivCategory('cs.DC')).toBe('cs.DC');
    expect(parseArxivCategory('https://arxiv.org/list/math.CO/recent')).toBe('math.CO');
    expect(parseArxivCategory('not a category!')).toBeUndefined();
    expect(parseAuthorRef('https://www.semanticscholar.org/author/Diego-Ongaro/1001')).toBe('1001');
  });
});

test('an S2 record keeps every name the paper goes by', () => {
  const item = paperFromS2(paper(PAPERS[0]!))!;
  expect(item).toMatchObject({
    external_id: RAFT,
    url: 'https://arxiv.org/abs/1401.00001',
    creator: 'Diego Ongaro et al.',
    creator_external_id: '1001',
    container: 'USENIX ATC',
    published: '2014-06-19T00:00:00Z',
    extra: {refs: ['ARXIV:1401.00001', 'DOI:10.5555/raft.2014', `CorpusId:${parseInt(RAFT.slice(0, 6), 16)}`], arxiv_id: '1401.00001', pdf_url: `https://example.org/${RAFT}.pdf`},
  });
});

test('arXiv feed entries, with reading time from the page count', async () => {
  const entries = parseArxivFeed(await fixture('arxiv-cs-dc.xml'));
  expect(entries.map(e => e.arxivId)).toEqual(['2609.01002', '2609.01001']);
  expect(entries[0]!.item).toMatchObject({
    external_id: 'ARXIV:2609.01002',
    title: 'Leaderless Replication with Bounded Staleness',
    abstract: 'We present a replication protocol that <bounds> staleness without a leader.',
    creator: 'Ada Example et al.',
    container: 'cs.DC',
    length_minutes: 56,
    extra: {pdf_url: 'http://arxiv.org/pdf/2609.01002v1'},
  });
  expect(entries[1]!.item.extra?.['refs']).toEqual(['ARXIV:2609.01001', 'DOI:10.1145/1234567.7654321']);
  expect(pagesFromComment('Accepted at X. 9 pages')).toBe(9);
});
