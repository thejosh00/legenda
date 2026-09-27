import {useState} from 'react';
import {api, post, type Interest, type ProfileVersion} from './api.ts';
import {Markdown} from './markdown.tsx';
import {ago, useLoad, useShared} from './state.ts';

function Interests() {
  const shared = useShared();
  const {data} = useLoad<{interests: Interest[]}>('/api/interests');
  const [topic, setTopic] = useState('');
  const [strength, setStrength] = useState<Interest['strength']>('core');
  const [sources, setSources] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const add = async () => {
    try {
      await post('/api/interests', {topic, strength, sources, note});
      setTopic('');
      setNote('');
    } catch (e) {
      shared.toast(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = async (id: string) => {
    try {
      await api('DELETE', `/api/interests/${encodeURIComponent(id)}`);
    } catch (e) {
      shared.toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="source-block">
      <h3>Interests</h3>
      <p className="muted">Topics in your words. The curator leans on core ones, explores curious ones, and never searches for avoided ones.</p>
      <form
        className="follow-form"
        onSubmit={e => {
          e.preventDefault();
          void add();
        }}
      >
        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. distributed consensus" aria-label="Topic" />
        <select value={strength} onChange={e => setStrength(e.target.value as Interest['strength'])} aria-label="Strength">
          <option value="core">core</option>
          <option value="curious">curious</option>
          <option value="avoid">avoid</option>
        </select>
        {shared.who.sources.length > 1 && (
          <div className="checks">
            {shared.who.sources.map(s => (
              <label key={s.id} className="check">
                <input type="checkbox" checked={sources.includes(s.id)} onChange={e => setSources(e.target.checked ? [...sources, s.id] : sources.filter(x => x !== s.id))} />
                {s.id === 'docs' ? (shared.who.docs?.label ?? s.name) : s.name}
              </label>
            ))}
            <span className="muted small-text">{sources.length === 0 ? '(all sources)' : ''}</span>
          </div>
        )}
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
        <button className="primary" type="submit" disabled={topic.trim() === ''}>
          Add
        </button>
      </form>
      <ul className="interests">
        {(data?.interests ?? []).map(i => (
          <li key={i.id} className={`interest ${i.strength}`}>
            <span className={`pill ${i.strength}`}>{i.strength}</span>
            <span className="topic">{i.topic}</span>
            {i.sources.length > 0 && <span className="muted small-text">{i.sources.join(', ')}</span>}
            {i.note && <span className="muted small-text">— {i.note}</span>}
            <button type="button" className="small ghost" aria-label={`Remove ${i.topic}`} onClick={() => void remove(i.id)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Profile() {
  const shared = useShared();
  const {data} = useLoad<{profile: ProfileVersion | null; history: ProfileVersion[]}>('/api/profile?history=true');
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<number>();
  const profile = data?.profile ?? null;

  const save = async () => {
    try {
      await api('PUT', '/api/profile', {body, note: note.trim() || 'edited by hand'});
      setEditing(false);
      setNote('');
      shared.toast('Profile saved');
    } catch (e) {
      shared.toast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="source-block">
      <div className="block-head">
        <h3>Profile</h3>
        {!editing && (
          <button
            type="button"
            className="small"
            onClick={() => {
              setBody(profile?.body ?? '');
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      <p className="muted">The curator's working summary of your taste. It rewrites it as it learns; anything you write here, it keeps.</p>
      {editing ? (
        <div className="editor">
          <textarea rows={14} value={body} onChange={e => setBody(e.target.value)} />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="What changed (optional)" />
          <div className="row-actions">
            <button type="button" className="primary" onClick={() => void save()}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : profile === null ? (
        <p className="empty muted">No profile yet. The curator writes one after its first run, or write your own.</p>
      ) : (
        <div className="profile">
          <p className="meta">
            v{profile.version} · {profile.actor === 'you' ? 'you' : profile.actor} · {ago(profile.at)}
          </p>
          <Markdown text={profile.body} />
        </div>
      )}
      {(data?.history.length ?? 0) > 1 && (
        <details className="history">
          <summary>History ({data!.history.length} versions)</summary>
          <ul>
            {data!.history.map(v => (
              <li key={v.version}>
                <button type="button" className="link" onClick={() => setOpen(open === v.version ? undefined : v.version)}>
                  v{v.version}
                </button>{' '}
                <span className={v.actor === 'you' ? '' : 'agent-text'}>{v.actor}</span> · {ago(v.at)}
                {v.note && <> — {v.note}</>}
                {open === v.version && <pre className="profile-raw">{v.body}</pre>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function TasteView() {
  return (
    <section className="narrow">
      <h2>Taste</h2>
      <Interests />
      <Profile />
    </section>
  );
}
