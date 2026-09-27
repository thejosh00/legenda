import {usageError} from '../../core/errors.ts';
import {addInterest, latestProfile, listInterests, profileHistory, removeInterest, setProfile} from '../../db/taste.ts';
import {requireStr, str, strList, type Route} from '../http.ts';

export const tasteRoutes: Route[] = [
  {method: 'GET', path: '/api/interests', handler: ctx => ({interests: listInterests(ctx)})},
  {
    method: 'POST',
    path: '/api/interests',
    userOnly: 'changing interests',
    handler: (ctx, req) =>
      ctx.write(() => ({
        interest: addInterest(ctx, {
          topic: requireStr(req.body, 'topic'),
          strength: str(req.body, 'strength') ?? 'core',
          sources: strList(req.body, 'sources').flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean),
          note: str(req.body, 'note'),
        }),
      })),
  },
  {
    method: 'DELETE',
    path: '/api/interests/:ref',
    userOnly: 'changing interests',
    handler: (ctx, req) => ctx.write(() => ({interest: removeInterest(ctx, req.params['ref']!)})),
  },
  {
    method: 'GET',
    path: '/api/profile',
    handler: (ctx, req) => ({
      profile: latestProfile(ctx),
      ...(req.query.get('history') === 'true' || req.query.get('history') === '1' ? {history: profileHistory(ctx)} : {}),
    }),
  },
  {
    method: 'PUT',
    path: '/api/profile',
    handler: (ctx, req) =>
      ctx.write(() => {
        const body = str(req.body, 'body');
        if (body === undefined) throw usageError('the profile body is required');
        return setProfile(ctx, body.trim() === '' ? '' : `${body.trimEnd()}\n`, str(req.body, 'note') ?? '');
      }),
  },
];
