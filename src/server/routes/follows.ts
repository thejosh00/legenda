import {AppError, EXIT_NOT_FOUND, notFound, usageError} from '../../core/errors.ts';
import {FOLLOW_STATUSES, type FollowCandidate, type FollowStatus} from '../../core/types.ts';
import {blockCreatorOf, listFollows, resolveFollowRef, setCursor, unfollow, updateFollow, upsertFollow} from '../../db/follows.ts';
import {resolveItem} from '../../db/items.ts';
import {bool, requireStr, str, type Route} from '../http.ts';
import {sourceParam} from './items.ts';

export const followRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/follows',
    handler: (ctx, req) => {
      const status = req.query.get('status');
      if (status !== null && status !== '' && !FOLLOW_STATUSES.includes(status as FollowStatus)) throw usageError('status must be following or blocked');
      return {follows: listFollows(ctx, {source: sourceParam(req.query.get('source')), ...(status ? {status: status as FollowStatus} : {})})};
    },
  },
  {
    method: 'POST',
    path: '/api/follows',
    userOnly: 'following things',
    handler: async (ctx, req) => {
      const sourceId = sourceParam(requireStr(req.body, 'source'))!;
      const ref = requireStr(req.body, 'ref', 'what to follow');
      const kind = str(req.body, 'kind')?.trim() || undefined;
      const source = ctx.sources.get(sourceId);
      let candidate: FollowCandidate;
      if (source.resolveFollow !== undefined) {
        candidate = await source.resolveFollow(ref, kind);
      } else {
        const chosen = kind ?? (source.followKinds.length === 1 ? source.followKinds[0] : undefined);
        if (chosen === undefined) throw usageError(`say which kind of ${source.label.name} follow: --kind ${source.followKinds.join('|')}`);
        candidate = {kind: chosen, external_id: ref, title: str(req.body, 'title')?.trim() || ref, url: null};
      }
      return ctx.write(() => upsertFollow(ctx, {source: sourceId, candidate, status: 'following', note: str(req.body, 'note'), screened: bool(req.body, 'screened')}));
    },
  },
  {
    method: 'PATCH',
    path: '/api/follows/:ref',
    userOnly: 'changing follows',
    handler: (ctx, req) =>
      ctx.write(() => {
        const follow = resolveFollowRef(ctx, req.params['ref']!);
        return {follow: updateFollow(ctx, follow, {note: str(req.body, 'note'), screened: bool(req.body, 'screened'), title: str(req.body, 'title')?.trim() || undefined})};
      }),
  },
  {
    method: 'DELETE',
    path: '/api/follows/:ref',
    userOnly: 'unfollowing',
    handler: (ctx, req) =>
      ctx.write(() => {
        const follow = resolveFollowRef(ctx, req.params['ref']!);
        if (follow.status !== 'following') throw usageError(`${follow.title} is blocked, not followed; use unblock`);
        unfollow(ctx, follow);
        return {follow};
      }),
  },
  {
    method: 'POST',
    path: '/api/block',
    userOnly: 'blocking',
    handler: (ctx, req) =>
      ctx.write(() => {
        const ref = requireStr(req.body, 'ref', 'what to block');
        try {
          const follow = resolveFollowRef(ctx, ref);
          return {follow: updateFollow(ctx, follow, {status: 'blocked'})};
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== EXIT_NOT_FOUND) throw error;
        }
        try {
          return {follow: blockCreatorOf(ctx, resolveItem(ctx, ref))};
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== EXIT_NOT_FOUND) throw error;
        }
        throw notFound(`no follow or item "${ref}" to block`);
      }),
  },
  {
    method: 'POST',
    path: '/api/follows/:ref/unblock',
    userOnly: 'unblocking',
    handler: (ctx, req) =>
      ctx.write(() => {
        const follow = resolveFollowRef(ctx, req.params['ref']!);
        if (follow.status !== 'blocked') throw usageError(`${follow.title} is not blocked`);
        unfollow(ctx, follow);
        return {follow: {...follow, status: 'unblocked'}};
      }),
  },
  {
    method: 'POST',
    path: '/api/follows/:ref/cursor',
    agentOnly: "moving an agent-fed follow's cursor",
    handler: (ctx, req) =>
      ctx.write(() => ({follow: setCursor(ctx, resolveFollowRef(ctx, req.params['ref']!), requireStr(req.body, 'value', 'the cursor value'))})),
  },
];
