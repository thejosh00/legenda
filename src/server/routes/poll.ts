import {Ctx} from '../../db/context.ts';
import {resolveFollowRef} from '../../db/follows.ts';
import {pollAll, pollFollow, POLLER_ACTOR} from '../../db/poll.ts';
import {usageError} from '../../core/errors.ts';
import {str, type Route} from '../http.ts';

export const pollRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/poll',
    handler: async (ctx, req) => {
      const deps = {db: ctx.db, hub: ctx.hub, now: ctx.now, fetcher: ctx.fetcher, gates: ctx.gates};
      const ref = str(req.body, 'follow');
      if (ref === undefined) return {results: await pollAll(deps, {onlyDue: false})};
      const follow = resolveFollowRef(ctx, ref);
      if (follow.fetched_by !== 'app') throw usageError(`${follow.title} is fed by the agent, not polled by the app`);
      return {results: [await pollFollow(new Ctx(deps, POLLER_ACTOR), follow)]};
    },
  },
];
