import {useState} from 'react';
import type {ItemWithFeedback} from './api.ts';
import {ItemCard} from './ItemCard.tsx';
import {useLoad} from './state.ts';

export function HistoryView() {
  const [state, setState] = useState<'done' | 'dismissed'>('done');
  const {data, error} = useLoad<{items: ItemWithFeedback[]}>(`/api/items?state=${state}&feedback=1&limit=200`);
  return (
    <section>
      <div className="filters">
        <div className="seg">
          <button type="button" className={state === 'done' ? 'on' : ''} onClick={() => setState('done')}>
            Watched &amp; read
          </button>
          <button type="button" className={state === 'dismissed' ? 'on' : ''} onClick={() => setState('dismissed')}>
            Dismissed
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {data === undefined ? (
        <p className="muted">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="empty muted">Nothing {state} yet.</p>
      ) : (
        <div className="cards">
          {data.items.map(item => (
            <ItemCard key={item.id} item={item} history />
          ))}
        </div>
      )}
    </section>
  );
}
