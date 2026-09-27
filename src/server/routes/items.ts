import {AppError, EXIT_ERROR, usageError} from '../../core/errors.ts';
import {isSourceId, type SourceId} from '../../core/types.ts';
import {dismiss, feedbackForItems, feedbackSince, itemFeedback, markDone, restore} from '../../db/feedback.ts';
import {addByRef, listItems, parseItemFilter, resolveItem} from '../../db/items.ts';
import {bool, str, strList, type Route} from '../http.ts';

export function sourceParam(value: string | undefined | null): SourceId | undefined {
  if (value === undefined || value === null || value.trim() === '') return undefined;
  if (!isSourceId(value)) throw usageError('source must be one of youtube, papers, docs');
  return value;
}

export const itemRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/items',
    handler: (ctx, req) => {
      const items = listItems(ctx, parseItemFilter(req.query));
      if (req.query.get('feedback') !== '1') return {items};
      // The History view shows each item's reactions and reasons alongside it.
      const byItem = new Map<string, Array<{kind: string; note: string; at: string}>>();
      for (const f of feedbackForItems(ctx, items.map(i => i.id))) {
        const list = byItem.get(f.item_id) ?? [];
        list.push({kind: f.kind, note: f.note, at: f.at});
        byItem.set(f.item_id, list);
      }
      return {items: items.map(item => ({...item, feedback: byItem.get(item.id) ?? []}))};
    },
  },
  {
    method: 'GET',
    path: '/api/items/:ref',
    handler: (ctx, req) => {
      const item = resolveItem(ctx, req.params['ref']!);
      return {item, feedback: feedbackSince(ctx, '', item.id)};
    },
  },
  {
    method: 'POST',
    path: '/api/items',
    userOnly: 'adding items by hand',
    handler: async (ctx, req) => {
      const refs = strList(req.body, 'refs').map(r => r.trim()).filter(Boolean);
      if (refs.length === 0) throw usageError('give at least one URL to add');
      const source = sourceParam(str(req.body, 'source'));
      const results: Array<Record<string, unknown>> = [];
      for (const ref of refs) {
        try {
          const added = await addByRef(ctx, ref, source);
          results.push({ref, ok: true, existing: added.existing, item: added.item});
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          results.push({ref, ok: false, error: error.message, code: error.code});
        }
      }
      const failed = results.filter(r => r['ok'] === false);
      if (failed.length > 0) {
        const code = failed.length === results.length && refs.length === 1 ? (failed[0]!['code'] as number) : EXIT_ERROR;
        throw new AppError(failed.length === 1 ? String(failed[0]!['error']) : `${failed.length} of ${results.length} could not be added`, code, {results});
      }
      return {results};
    },
  },
  {
    method: 'POST',
    path: '/api/items/:ref/done',
    userOnly: 'marking things done',
    handler: (ctx, req) =>
      ctx.write(() => ({...markDone(ctx, resolveItem(ctx, req.params['ref']!), {reaction: str(req.body, 'reaction'), note: str(req.body, 'note')})})),
  },
  {
    method: 'POST',
    path: '/api/items/:ref/dismiss',
    userOnly: 'dismissing things',
    handler: (ctx, req) =>
      ctx.write(() => ({
        ...dismiss(ctx, resolveItem(ctx, req.params['ref']!), {reason: str(req.body, 'reason'), note: str(req.body, 'note'), block: bool(req.body, 'block')}),
      })),
  },
  {
    method: 'POST',
    path: '/api/items/:ref/restore',
    userOnly: 'restoring things to the list',
    handler: (ctx, req) => ctx.write(() => ({item: restore(ctx, resolveItem(ctx, req.params['ref']!))})),
  },
  {
    method: 'POST',
    path: '/api/items/:ref/feedback',
    userOnly: 'giving feedback',
    handler: (ctx, req) =>
      ctx.write(() => {
        const kind = str(req.body, 'kind');
        if (kind === undefined) throw usageError('which feedback? more, less or comment');
        const item = resolveItem(ctx, req.params['ref']!);
        return {item, feedback: itemFeedback(ctx, item, kind, str(req.body, 'note'))};
      }),
  },
];
