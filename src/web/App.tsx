import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {api, get, type WhoAmI} from './api.ts';
import {AddView} from './Add.tsx';
import {CuratorView} from './Curator.tsx';
import {FollowingView} from './Following.tsx';
import {HistoryView} from './History.tsx';
import {ListView} from './List.tsx';
import {SharedContext, type Shared} from './state.ts';
import {TasteView} from './Taste.tsx';
import logo from './logo.svg';

const VIEWS = [
  {id: 'list', label: 'List', icon: '☰'},
  {id: 'add', label: 'Add', icon: '＋'},
  {id: 'following', label: 'Following', icon: '★'},
  {id: 'taste', label: 'Taste', icon: '♥'},
  {id: 'curator', label: 'Curator', icon: '✦'},
  {id: 'history', label: 'History', icon: '↺'},
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

function viewFromHash(): ViewId {
  const id = window.location.hash.replace(/^#\/?/, '');
  return (VIEWS.find(v => v.id === id)?.id ?? 'list') as ViewId;
}

function SignIn({onSignedIn}: {onSignedIn: () => void}) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string>();
  const submit = async (value: string) => {
    try {
      await api('POST', '/api/session', {token: value.trim()});
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <main className="signin">
      <h1 className="brand">
        <img className="logo" src={logo} alt="" width={40} height={40} />
        legenda
      </h1>
      <p className="muted">Things that ought to be read. Sign in with a token for <code>you</code>:</p>
      <pre className="hint">legenda token you</pre>
      <form
        onSubmit={e => {
          e.preventDefault();
          void submit(token);
        }}
      >
        <input autoFocus placeholder="lg_…" value={token} onChange={e => setToken(e.target.value)} aria-label="token" />
        <button className="primary" type="submit" disabled={token.trim() === ''}>
          Sign in
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

export function App() {
  const [who, setWho] = useState<WhoAmI | null | undefined>(undefined);
  const [view, setView] = useState<ViewId>(viewFromHash);
  const [tick, setTick] = useState(0);
  const [toastText, setToastText] = useState<string>();
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    try {
      setWho(await get<WhoAmI>('/api/whoami'));
    } catch {
      setWho(null);
    }
  }, []);

  // A link with ?token=… signs this browser in once, then forgets the token.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token === null) {
      void load();
      return;
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    api('POST', '/api/session', {token})
      .catch(() => undefined)
      .finally(() => void load());
  }, [load]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Live updates: any change anywhere bumps the tick, debounced.
  useEffect(() => {
    if (!who) return;
    const source = new EventSource('/api/events');
    let pending: ReturnType<typeof setTimeout> | undefined;
    source.addEventListener('change', () => {
      clearTimeout(pending);
      pending = setTimeout(() => setTick(t => t + 1), 120);
    });
    source.addEventListener('hello', () => setTick(t => t + 1));
    return () => {
      clearTimeout(pending);
      source.close();
    };
  }, [who]);

  const shared = useMemo<Shared | null>(
    () =>
      who
        ? {
            who,
            tick,
            toast(message) {
              clearTimeout(toastTimer.current);
              setToastText(message);
              toastTimer.current = setTimeout(() => setToastText(undefined), 3500);
            },
            source: id => who.sources.find(s => s.id === id),
          }
        : null,
    [who, tick],
  );

  if (who === undefined) return <main className="loading">…</main>;
  if (who === null || shared === null) return <SignIn onSignedIn={() => void load()} />;

  return (
    <SharedContext.Provider value={shared}>
      <div className="shell">
        <header className="topbar">
          <a className="brand" href="#/list">
            <img className="logo" src={logo} alt="" width={26} height={26} />
            legenda
          </a>
          <nav className="tabs-top">
            {VIEWS.map(v => (
              <a key={v.id} href={`#/${v.id}`} className={view === v.id ? 'active' : ''}>
                {v.label}
              </a>
            ))}
          </nav>
        </header>
        <main className="content">
          {view === 'list' && <ListView />}
          {view === 'add' && <AddView />}
          {view === 'following' && <FollowingView />}
          {view === 'taste' && <TasteView />}
          {view === 'curator' && <CuratorView />}
          {view === 'history' && <HistoryView />}
        </main>
        <nav className="tabs-bottom">
          {VIEWS.map(v => (
            <a key={v.id} href={`#/${v.id}`} className={view === v.id ? 'active' : ''}>
              <span aria-hidden>{v.icon}</span>
              {v.label}
            </a>
          ))}
        </nav>
        {toastText && (
          <div className="toast" role="status">
            {toastText}
          </div>
        )}
      </div>
    </SharedContext.Provider>
  );
}
