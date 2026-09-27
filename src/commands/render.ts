/**
 * Text for a person reading the terminal. Agents use `--json` and never see this.
 */
import type {Item} from '../core/types.ts';

const SOURCE_TAG: Record<string, string> = {youtube: 'yt', papers: 'pa', docs: 'dc'};

export function age(iso: string | null, nowMs = Date.now()): string {
  if (iso === null) return '';
  const days = Math.floor((nowMs - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 60) return `${days}d`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function itemLine(item: Item): string {
  const title = item.title || item.url;
  const bits = [item.creator, item.length_minutes === null ? '' : `${item.length_minutes}m`, age(item.published ?? item.added)].filter(Boolean);
  const badge = item.origin === 'agent' ? ' ✦' : '';
  const state = item.state === 'queue' ? '' : ` [${item.state}]`;
  return `${item.id}  ${SOURCE_TAG[item.source] ?? item.source}  ${title}${badge}${bits.length > 0 ? `  — ${bits.join(', ')}` : ''}${state}`;
}

export function table(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  return rows.map(row => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ').trimEnd());
}
