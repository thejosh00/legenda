import {useState} from 'react';
import {api, post, type Follow, type SourceInfo} from './api.ts';
import {ago, useLoad, useShared} from './state.ts';

const KIND_HINT: Record<string, string> = {
  channel: 'channel URL, @handle, UC… id, or a video from it',
  author: 'Semantic Scholar author URL or id',
  category: 'arXiv category, e.g. cs.DC',
  query: 'a search',
  collection: 'space / wiki / folder key',
  tag: 'label',
};

const SCREENED_BY_DEFAULT = (source: string, kind: string) => source === 'docs' || (source === 'papers' && (kind === 'category' || kind === 'query'));

function FollowForm({source}: {source: SourceInfo}) {
  const shared = useShared();
  const [kind, setKind] = useState(source.follow_kinds[0]!);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [screened, setScreened] = useState(SCREENED_BY_DEFAULT(source.id, source.follow_kinds[0]!));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const body = await post<{follow: Follow; existing: boolean}>('/api/follows', {source: source.id, ref: ref.trim(), kind, note, screened});
      shared.toast(`${body.existing ? 'Already following' : 'Following'} ${body.follow.title}`);
      setRef('');
      setNote('');
    } catch (e) {
      shared.toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="follow-form"
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      {source.follow_kinds.length > 1 && (
        <select
          value={kind}
          onChange={e => {
            setKind(e.target.value);
            setScreened(SCREENED_BY_DEFAULT(source.id, e.target.value));
          }}
          aria-label="Kind"
        >
          {source.follow_kinds.map(k => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      )}
      <input value={ref} onChange={e => setRef(e.target.value)} placeholder={KIND_HINT[kind] ?? kind} aria-label="What to follow" />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder={screened ? 'Screening rule, e.g. "only design docs"' : 'Note (optional)'} aria-label="Note" />
      <label className="check">
        <input type="checkbox" checked={screened} onChange={e => setScreened(e.target.checked)} /> screened by the curator
      </label>
      <button className="primary" type="submit" disabled={busy || ref.trim() === ''}>
        Follow
      </button>
    </form>
  );
}

function FollowRow({follow}: {follow: Follow}) {
  const shared = useShared();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(follow.note);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      shared.toast(message);
    } catch (e) {
      shared.toast(e instanceof Error ? e.message : String(e));
    }
  };
  const path = `/api/follows/${encodeURIComponent(follow.id)}`;
  return (
    <li className={`follow ${follow.status}`}>
      <div className="follow-head">
        <strong>{follow.url ? <a href={follow.url} target="_blank" rel="noreferrer">{follow.title}</a> : follow.title}</strong>
        <span className="pill soft">{follow.kind}</span>
        {follow.status === 'blocked' && <span className="pill danger">blocked</span>}
        {follow.screened && follow.status === 'following' && <span className="pill soft">screened</span>}
      </div>
      {follow.status === 'following' && (
        <p className="meta">
          {follow.fetched_by === 'app' ? (follow.last_checked ? `checked ${ago(follow.last_checked)}` : 'not checked yet') : follow.cursor ? `read up to ${follow.cursor}` : 'not read yet'}
          {follow.last_error && <span className="error"> · {follow.last_error}</span>}
        </p>
      )}
      {editing ? (
        <div className="inline-edit">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note / screening rule" autoFocus />
          <button type="button" className="primary small" onClick={() => void run(() => api('PATCH', path, {note}), 'Saved').then(() => setEditing(false))}>
            Save
          </button>
        </div>
      ) : (
        follow.note && <p className="note-text">“{follow.note}”</p>
      )}
      <div className="row-actions">
        {follow.status === 'following' ? (
          <>
            <button type="button" className="small" onClick={() => setEditing(!editing)}>
              {follow.note ? 'Edit note' : 'Add note'}
            </button>
            <button type="button" className="small" onClick={() => void run(() => api('PATCH', path, {screened: !follow.screened}), follow.screened ? 'No longer screened' : 'Now screened')}>
              {follow.screened ? 'Unscreen' : 'Screen'}
            </button>
            {follow.fetched_by === 'app' && (
              <button type="button" className="small" onClick={() => void run(() => post('/api/poll', {follow: follow.id}), `Checked ${follow.title}`)}>
                Check now
              </button>
            )}
            <button type="button" className="small" onClick={() => void run(() => api('DELETE', path), `Unfollowed ${follow.title}`)}>
              Unfollow
            </button>
            <button type="button" className="small danger" onClick={() => void run(() => post('/api/block', {ref: follow.id}), `Blocked ${follow.title}`)}>
              Block
            </button>
          </>
        ) : (
          <button type="button" className="small" onClick={() => void run(() => post(`${path}/unblock`), `Unblocked ${follow.title}`)}>
            Unblock
          </button>
        )}
      </div>
    </li>
  );
}

export function FollowingView() {
  const {who} = useShared();
  const {data, error} = useLoad<{follows: Follow[]}>('/api/follows');
  return (
    <section className="narrow">
      <h2>Following</h2>
      {error && <p className="error">{error}</p>}
      {who.sources.map(source => {
        const follows = (data?.follows ?? []).filter(f => f.source === source.id);
        const following = follows.filter(f => f.status === 'following');
        const blocked = follows.filter(f => f.status === 'blocked');
        return (
          <div key={source.id} className="source-block">
            <h3>{source.id === 'docs' ? (who.docs?.label ?? source.name) : source.name}</h3>
            <FollowForm source={source} />
            {following.length > 0 && (
              <ul className="follows">
                {following.map(f => (
                  <FollowRow key={f.id} follow={f} />
                ))}
              </ul>
            )}
            {blocked.length > 0 && (
              <details className="blocked">
                <summary>{blocked.length} blocked</summary>
                <ul className="follows">
                  {blocked.map(f => (
                    <FollowRow key={f.id} follow={f} />
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}
