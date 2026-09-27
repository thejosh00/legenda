import {useState} from 'react';
import {ApiError, post, type Item} from './api.ts';
import {useShared} from './state.ts';

interface Result {
  ref: string;
  ok: boolean;
  existing?: boolean;
  item?: Item;
  error?: string;
}

/** A pasted link that is a channel or author rather than one thing: offer to follow it. */
export function followGuess(ref: string): {source: string; kind?: string} | undefined {
  const text = ref.trim();
  if (/youtube\.com\/(@|channel\/|c\/|user\/)/i.test(text) || /^@[\w.-]+$/.test(text)) return {source: 'youtube'};
  if (/semanticscholar\.org\/author\//i.test(text)) return {source: 'papers', kind: 'author'};
  if (/arxiv\.org\/list\//i.test(text)) return {source: 'papers', kind: 'category'};
  return undefined;
}

export function AddView() {
  const shared = useShared();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const submit = async () => {
    const refs = text.split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (refs.length === 0) return;
    setBusy(true);
    try {
      const body = await post<{results: Result[]}>('/api/items', {refs});
      setResults(body.results);
      setText('');
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.body['results'])) {
        const got = e.body['results'] as Result[];
        setResults(got);
        setText(got.filter(r => !r.ok).map(r => r.ref).join('\n'));
      } else shared.toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const follow = async (ref: string, guess: {source: string; kind?: string}) => {
    try {
      const body = await post<{follow: {title: string}}>('/api/follows', {source: guess.source, ref, ...(guess.kind ? {kind: guess.kind} : {})});
      shared.toast(`Following ${body.follow.title}`);
      setResults(rs => rs.filter(r => r.ref !== ref));
      setText(t => t.split('\n').filter(line => line.trim() !== ref).join('\n'));
    } catch (e) {
      shared.toast(e instanceof Error ? e.message : String(e));
    }
  };

  const names = shared.who.sources.map(s => (s.id === 'docs' ? `${shared.who.docs?.label ?? 'docs'} links` : s.id === 'youtube' ? 'videos' : 'arXiv / DOI / Semantic Scholar links')).join(', ');

  return (
    <section className="narrow">
      <h2>Add</h2>
      <p className="muted">Paste links, one per line: {names}.</p>
      <textarea rows={5} value={text} placeholder="https://…" onChange={e => setText(e.target.value)} onKeyDown={e => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
      }} />
      <button className="primary wide" type="button" disabled={busy || text.trim() === ''} onClick={() => void submit()}>
        {busy ? 'Adding…' : 'Add to the list'}
      </button>
      {results.length > 0 && (
        <ul className="results">
          {results.map(r => {
            const guess = r.ok ? undefined : followGuess(r.ref);
            return (
              <li key={r.ref} className={r.ok ? 'ok' : 'failed'}>
                {r.ok ? (
                  <>
                    <strong>{r.existing ? 'Already known' : 'Added'}</strong>{' '}
                    {r.item?.title || r.item?.url}
                    {r.existing && r.item?.state !== 'queue' ? ` (${r.item?.state})` : ''}
                  </>
                ) : guess && shared.who.enabled_sources.includes(guess.source) ? (
                  <>
                    <span>{r.ref} looks like something to follow.</span>{' '}
                    <button type="button" className="primary small" onClick={() => void follow(r.ref, guess)}>
                      Follow it
                    </button>
                  </>
                ) : (
                  <>
                    <strong>Could not add</strong> {r.ref}: {r.error}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
