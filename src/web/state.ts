/**
 * What every view shares: the instance's sources, a counter that ticks whenever the
 * server reports a change, and a way to say something briefly.
 */
import {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {get, type SourceInfo, type WhoAmI} from './api.ts';

export interface Shared {
  who: WhoAmI;
  /** Goes up on every server event: views refetch when it changes. */
  tick: number;
  toast(message: string): void;
  source(id: string): SourceInfo | undefined;
}

export const SharedContext = createContext<Shared | null>(null);

export function useShared(): Shared {
  const shared = useContext(SharedContext);
  if (shared === null) throw new Error('useShared outside the app');
  return shared;
}

/** Fetch on mount and whenever the tick moves. */
export function useLoad<T>(path: string | null, deps: unknown[] = []): {data: T | undefined; error: string | undefined; reload: () => void} {
  const {tick} = useShared();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    get<T>(path)
      .then(result => {
        if (live) {
          setData(result);
          setError(undefined);
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [path, tick, nonce, ...deps]);
  return {data, error, reload};
}

export function ago(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d ago`;
  if (days < 730) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function length(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
