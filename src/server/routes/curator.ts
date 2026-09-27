import {usageError} from '../../core/errors.ts';
import {agentContext} from '../../db/agentContext.ts';
import {annotate, suggest} from '../../db/curator.ts';
import {addFound, enrich} from '../../db/found.ts';
import {resolveItem} from '../../db/items.ts';
import {acceptIntake, passIntake, pendingIntake} from '../../db/intake.ts';
import {finishRun, getRun, listRuns, runItems, startRun} from '../../db/runs.ts';
import {int, object, requireStr, str, strList, type Route} from '../http.ts';
import {sourceParam} from './items.ts';

function parseQueries(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? [];
  try {
    return JSON.parse(value);
  } catch {
    throw usageError('--queries must be JSON, e.g. \'{"youtube":["hand tool joinery"]}\'');
  }
}

export const curatorRoutes: Route[] = [
  {method: 'GET', path: '/api/context', handler: ctx => agentContext(ctx)},

  {method: 'POST', path: '/api/runs', agentOnly: 'starting a curator run', handler: ctx => ctx.write(() => startRun(ctx))},
  {
    method: 'POST',
    path: '/api/runs/:id/finish',
    agentOnly: 'finishing a curator run',
    handler: (ctx, req) =>
      ctx.write(() => ({
        run: finishRun(ctx, req.params['id']!, {
          outcome: requireStr(req.body, 'outcome'),
          queries: parseQueries(req.body['queries']),
          considered: int(req.body, 'considered'),
          summary: str(req.body, 'summary'),
        }),
      })),
  },
  {
    method: 'GET',
    path: '/api/runs',
    handler: (ctx, req) => ({
      runs: listRuns(ctx, Number(req.query.get('limit') ?? 30) || 30).map(run => ({...run, items: runItems(ctx, run.id)})),
    }),
  },
  {
    method: 'GET',
    path: '/api/runs/:id',
    handler: (ctx, req) => {
      const run = getRun(ctx, req.params['id']!);
      if (run === undefined) throw usageError(`no run "${req.params['id']}"`);
      return {run: {...run, items: runItems(ctx, run.id)}};
    },
  },

  {
    method: 'GET',
    path: '/api/sources/:source/search',
    handler: async (ctx, req) => {
      const source = ctx.sources.get(sourceParam(req.params['source'])!);
      if (source.search === undefined) throw usageError(`${source.label.name} has no search in the app; the agent searches it with its own tools`);
      const q = req.query.get('q')?.trim();
      if (!q) throw usageError('what to search for? give a query');
      const max = Number(req.query.get('max') ?? '');
      const yearFrom = Number(req.query.get('year_from') ?? '');
      const duration = req.query.get('duration') ?? undefined;
      if (duration !== undefined && !['short', 'medium', 'long'].includes(duration)) throw usageError('duration must be short, medium or long');
      const results = await source.search(q, {
        ...(Number.isInteger(max) && max > 0 ? {max} : {}),
        ...(req.query.get('published_after') ? {publishedAfter: req.query.get('published_after')!} : {}),
        ...(duration === undefined ? {} : {duration: duration as 'short' | 'medium' | 'long'}),
        ...(Number.isInteger(yearFrom) && yearFrom > 0 ? {yearFrom} : {}),
      });
      return {results: annotate(ctx, results)};
    },
  },
  {
    method: 'POST',
    path: '/api/sources/:source/details',
    handler: async (ctx, req) => {
      const source = ctx.sources.get(sourceParam(req.params['source'])!);
      if (source.details === undefined) throw usageError(`${source.label.name} has no lookup in the app`);
      const refs = strList(req.body, 'refs').map(r => r.trim()).filter(Boolean);
      if (refs.length === 0) throw usageError('give at least one id or URL');
      return {results: annotate(ctx, await source.details(refs))};
    },
  },
  {
    method: 'GET',
    path: '/api/sources/:source/recommend',
    handler: async (ctx, req) => {
      const source = ctx.sources.get(sourceParam(req.params['source'])!);
      if (source.recommend === undefined) throw usageError(`${source.label.name} has no recommendations`);
      const {positive, negative} = (await import('../../db/recommend.ts')).feedbackSeeds(ctx, source.id);
      const max = Number(req.query.get('max') ?? 20) || 20;
      if (positive.length === 0) return {results: [], positive, negative, note: 'no positive feedback yet to recommend from'};
      return {results: annotate(ctx, await source.recommend(positive, negative, max)), positive, negative};
    },
  },

  {
    method: 'POST',
    path: '/api/suggest',
    agentOnly: 'suggesting',
    handler: async (ctx, req) => {
      const added = await suggest(ctx, {source: requireStr(req.body, 'source'), ref: requireStr(req.body, 'ref', 'what to suggest'), reason: str(req.body, 'reason'), run: str(req.body, 'run')});
      return {...added, state: added.item.state};
    },
  },

  {
    method: 'POST',
    path: '/api/add-found',
    agentOnly: 'adding what the curator found',
    handler: (ctx, req) =>
      ctx.write(() => {
        const item = object(req.body, 'item');
        if (item === undefined) throw usageError('--json-item is required');
        const added = addFound(ctx, {source: requireStr(req.body, 'source'), run: str(req.body, 'run'), origin: str(req.body, 'origin'), follow: str(req.body, 'follow'), reason: str(req.body, 'reason'), item});
        return {...added, state: added.item.state};
      }),
  },
  {
    method: 'POST',
    path: '/api/items/:ref/enrich',
    handler: (ctx, req) =>
      ctx.write(() => {
        const item = object(req.body, 'item');
        if (item === undefined) throw usageError('--json-item is required');
        return enrich(ctx, resolveItem(ctx, req.params['ref']!), item);
      }),
  },

  {method: 'GET', path: '/api/intake', handler: (ctx, req) => ({intake: pendingIntake(ctx, sourceParam(req.query.get('source')))})},
  {
    method: 'POST',
    path: '/api/intake/accept',
    handler: (ctx, req) =>
      ctx.write(() => {
        const ids = strList(req.body, 'ids');
        if (ids.length === 0) throw usageError('which candidates? give intake ids');
        const reason = str(req.body, 'reason') ?? '';
        const run = str(req.body, 'run');
        return {results: ids.map(id => acceptIntake(ctx, id, reason, run))};
      }),
  },
  {
    method: 'POST',
    path: '/api/intake/pass',
    handler: (ctx, req) =>
      ctx.write(() => {
        const ids = strList(req.body, 'ids');
        if (ids.length === 0) throw usageError('which candidates? give intake ids');
        return {results: ids.map(id => passIntake(ctx, id))};
      }),
  },
];

