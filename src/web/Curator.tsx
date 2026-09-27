import type {Run} from './api.ts';
import {ago, useLoad, useShared} from './state.ts';

const OUTCOME: Record<string, string> = {ok: 'done', partial: 'partly done', needs_auth: 'needs sign-in', failed: 'failed'};

function queriesText(queries: unknown): Array<[string, string[]]> {
  if (queries === null || typeof queries !== 'object') return [];
  if (Array.isArray(queries)) return queries.length === 0 ? [] : [['', queries.map(String)]];
  return Object.entries(queries as Record<string, unknown>).map(([source, q]) => [source, Array.isArray(q) ? q.map(String) : [String(q)]]);
}

export function CuratorView() {
  const {who} = useShared();
  const {data, error} = useLoad<{runs: Run[]}>('/api/runs');
  const runs = data?.runs ?? [];
  const latest = runs[0];
  return (
    <section className="narrow">
      <h2>Curator</h2>
      {latest?.outcome === 'needs_auth' && (
        <div className="alert">
          <strong>The curator needs you to sign in again{who.docs ? ` to ${who.docs.label}` : ''}.</strong>
          {who.docs?.reauth_hint && (
            <p>
              To fix it: <code>{who.docs.reauth_hint}</code>
            </p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {data !== undefined && runs.length === 0 && (
        <p className="empty muted">The curator has not run yet. See the README for running it daily under otto.</p>
      )}
      <ul className="runs">
        {runs.map(run => (
          <li key={run.id} className={`run ${run.outcome ?? 'running'}`}>
            <div className="run-head">
              <span className={`pill ${run.outcome ?? 'running'}`}>{run.outcome === null ? 'running' : OUTCOME[run.outcome]}</span>
              <strong>{new Date(run.started).toLocaleString()}</strong>
              <span className="muted">{ago(run.started)}</span>
            </div>
            <p className="meta">
              considered {run.considered} · suggested {run.suggested} · from follows {run.from_follows}
            </p>
            {run.summary && <p>{run.summary}</p>}
            {queriesText(run.queries).length > 0 && (
              <details>
                <summary>Searches</summary>
                <ul className="queries">
                  {queriesText(run.queries).map(([source, qs]) => (
                    <li key={source}>
                      {source && <strong>{source}: </strong>}
                      {qs.join(' · ')}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {run.items.length > 0 && (
              <ul className="run-items">
                {run.items.map(item => (
                  <li key={item.id}>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.title || item.url}
                    </a>
                    <span className="muted"> — {item.creator}</span>
                    {item.state !== 'queue' && <span className={`pill ${item.state}`}>{item.state}</span>}
                    {item.reason && <p className="small-text muted">{item.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
