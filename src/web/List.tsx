import {useState} from 'react';
import type {Item} from './api.ts';
import {ItemCard} from './ItemCard.tsx';
import {useLoad, useShared} from './state.ts';

type OriginFilter = '' | 'follow' | 'agent' | 'you';

function storedFilter(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`legenda.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(`legenda.${key}`, value);
  } catch {
    // A private window: the filter just is not remembered.
  }
}

export function ListView() {
  const {who} = useShared();
  const [source, setSource] = useState(() => storedFilter('source', ''));
  const [origin, setOrigin] = useState<OriginFilter>(() => storedFilter('origin', '') as OriginFilter);
  const [sort, setSort] = useState(() => storedFilter('sort', 'newest'));
  const params = new URLSearchParams({state: 'queue', sort});
  if (source && who.enabled_sources.includes(source)) params.set('source', source);
  if (origin) params.set('origin', origin);
  const {data, error} = useLoad<{items: Item[]}>(`/api/items?${params}`);

  const choose = (key: string, set: (value: never) => void) => (value: string) => {
    remember(key, value);
    set(value as never);
  };

  return (
    <section>
      <div className="filters">
        {who.sources.length > 1 && (
          <div className="seg">
            {[{id: '', name: 'All'}, ...who.sources.map(s => ({id: s.id, name: s.id === 'docs' ? (who.docs?.label ?? s.name) : s.name}))].map(s => (
              <button key={s.id} type="button" className={source === s.id ? 'on' : ''} onClick={() => choose('source', setSource)(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="seg">
          {(
            [
              ['', 'Everything'],
              ['follow', 'Followed'],
              ['agent', 'Suggested'],
              ['you', 'Added by me'],
            ] as const
          ).map(([id, name]) => (
            <button key={id} type="button" className={origin === id ? 'on' : ''} onClick={() => choose('origin', setOrigin)(id)}>
              {name}
            </button>
          ))}
        </div>
        <select value={sort} onChange={e => choose('sort', setSort)(e.target.value)} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {data === undefined ? (
        <p className="muted">Loading…</p>
      ) : data.items.length === 0 ? (
        <div className="empty">
          <p>Nothing on the list{origin || source ? ' for this filter' : ''}.</p>
          <p className="muted">
            <a href="#/add">Add something</a>, <a href="#/following">follow a channel or author</a>, or let the curator find things.
          </p>
        </div>
      ) : (
        <div className="cards">
          <p className="count muted">{data.items.length} on the list</p>
          {data.items.map(item => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
