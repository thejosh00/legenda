/**
 * R27 (I8): every change is an event recording its actor — for every write route the
 * server declares, not a sample. The walk is driven by `allRoutes()`: a new write route
 * with neither a call below nor a named exception fails the test.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {allRoutes} from '../../src/server/api.ts';
import {startInstance, type Instance} from '../helpers/instance.ts';
import {CHANNEL, serveChannel, serveOembed} from '../helpers/youtube.ts';

const BASE = 'https://docs.example.com/wiki';
const YOU = 'you';
const AGENT = 'agent:curator';

/** Write routes that record no event under the caller's actor, each with its reason. */
const EXCEPTIONS: Record<string, string> = {
  'POST /api/sources/:source/details': 'a lookup, not a change to the list (POST only to carry a list of refs); with an API key it counts quota units, which writes without an event',
  'POST /api/poll': "its events are recorded under the poller's actor \"app\", not the caller's: who forced the poll is not recorded (asserted below)",
};

let lg: Instance;
beforeEach(async () => {
  lg = await startInstance({settings: {enabled_sources: 'youtube,docs', docs_base_url: BASE}});
  serveOembed(lg.web);
  await serveChannel(lg.web);
});
afterEach(async () => {
  await lg.stop();
});

const seq = () => (lg.db.query('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get() as {seq: number}).seq;
const actorsSince = (after: number) => (lg.db.query('SELECT actor FROM events WHERE seq > ?').all(after) as Array<{actor: string}>).map(e => e.actor);

async function send(actor: string, method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${lg.url}${path}`, {
    method,
    headers: {authorization: `Bearer ${lg.token(actor)}`, 'content-type': 'application/json'},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const result = (await response.json()) as any;
  expect({call: `${method} ${path}`, status: response.status, error: result.error}).toEqual({call: `${method} ${path}`, status: 200, error: undefined});
  return result;
}

test('every write route records an event with the caller as its actor', async () => {
  const walked: string[] = [];
  /** Call one declared write route with a valid body, and require an event by the caller from that call. */
  async function write(actor: string, route: string, params: Record<string, string>, body?: unknown): Promise<any> {
    const [method, pattern] = route.split(' ') as [string, string];
    const before = seq();
    const result = await send(actor, method, pattern.replace(/:([a-z_]+)/g, (_, name: string) => encodeURIComponent(params[name]!)), body);
    expect({route, actor, events_by: actorsSince(before)}).toEqual({route, actor, events_by: expect.arrayContaining([actor])});
    walked.push(route);
    return result;
  }

  // The list, by hand.
  const item = (await write(YOU, 'POST /api/items', {}, {refs: ['https://youtu.be/aaaaaaaaaa1']})).results[0].item.id;
  await write(YOU, 'POST /api/items/:ref/feedback', {ref: item}, {kind: 'more'});
  await write(YOU, 'POST /api/items/:ref/dismiss', {ref: item}, {});
  await write(YOU, 'POST /api/items/:ref/restore', {ref: item});
  await write(YOU, 'POST /api/items/:ref/done', {ref: item}, {reaction: 'liked'});

  // Follows: a screened channel (its videos wait in intake) and an agent-fed docs space.
  const channel = (await write(YOU, 'POST /api/follows', {}, {source: 'youtube', ref: CHANNEL, screened: true})).follow.id;
  await write(YOU, 'PATCH /api/follows/:ref', {ref: channel}, {note: 'joinery only'});
  const space = (await lg.j(['follow', 'docs', 'ENG', '--kind', 'collection'])).json.follow.id;

  // The poll is the named exception: it records events, but as "app", whoever asked.
  const beforePoll = seq();
  await send(AGENT, 'POST', '/api/poll', {});
  expect(actorsSince(beforePoll)).toContain('app');
  expect(actorsSince(beforePoll)).not.toContain(AGENT);
  const offered = (await send(AGENT, 'GET', '/api/intake')).intake.map((i: {id: string}) => i.id);
  expect(offered.length).toBeGreaterThanOrEqual(2);

  // The curator.
  const run = (await write(AGENT, 'POST /api/runs', {})).run.id;
  await write(AGENT, 'POST /api/intake/accept', {}, {ids: [offered[0]], reason: 'Joinery.', run});
  await write(AGENT, 'POST /api/intake/pass', {}, {ids: [offered[1]]});
  await write(AGENT, 'POST /api/suggest', {}, {source: 'youtube', ref: 'https://youtu.be/vid00000001', reason: 'Because.', run});
  await write(AGENT, 'POST /api/follows/:ref/cursor', {ref: space}, {value: '2026-09-10T12:00:00Z'});
  const page = {external_id: '1', url: `${BASE}/spaces/ENG/pages/1/Title`, title: 'Page 1', creator: 'A. Author', container: 'Engineering', published: '2026-09-10T12:00:00Z', length_minutes: 12, labels: ['rfc'], summary: 'Two lines about it.'};
  await write(AGENT, 'POST /api/add-found', {}, {source: 'docs', run, origin: 'follow', follow: space, item: page});
  const pasted = (await lg.j(['add', `${BASE}/spaces/ENG/pages/77/Onboarding`])).json.results[0].item.id;
  await write(AGENT, 'POST /api/items/:ref/enrich', {ref: pasted}, {item: {title: 'Onboarding', summary: 'How to start.'}});
  await write(AGENT, 'POST /api/runs/:id/finish', {id: run}, {outcome: 'ok', summary: 'Done.'});

  // Blocking, unblocking, unfollowing.
  await write(YOU, 'POST /api/block', {}, {ref: channel});
  await write(YOU, 'POST /api/follows/:ref/unblock', {ref: channel});
  await write(YOU, 'DELETE /api/follows/:ref', {ref: space});

  // Taste and settings.
  const interest = (await write(YOU, 'POST /api/interests', {}, {topic: 'hand tools'})).interest.id;
  await write(YOU, 'DELETE /api/interests/:ref', {ref: interest});
  await write(AGENT, 'PUT /api/profile', {}, {body: 'Likes hand tools.', note: 'liked one'});
  await write(YOU, 'PUT /api/settings/:key', {key: 'daily_follow_intake_cap'}, {value: '5'});

  // The route table decides what must be covered: every write route is walked or named.
  const declared = allRoutes().filter(r => r.method !== 'GET').map(r => `${r.method} ${r.path}`);
  expect(declared.filter(route => !walked.includes(route) && EXCEPTIONS[route] === undefined)).toEqual([]);
  // And nothing here is stale: no exception for a route that is gone or is walked.
  expect(Object.keys(EXCEPTIONS).filter(route => !declared.includes(route) || walked.includes(route))).toEqual([]);
  if (process.env['R27_LIST'] !== undefined) {
    for (const route of declared) console.log(walked.includes(route) ? `${route} — event with the caller's actor asserted` : `${route} — EXCEPTION: ${EXCEPTIONS[route]}`);
  }
});
