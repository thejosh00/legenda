/**
 * M3: what the web app relies on — the page and its bundle, signing a browser in with a
 * `you` token, and live updates: an item the agent adds reaches an open browser.
 */
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {startInstance, type Instance} from '../helpers/instance.ts';
import {serveOembed} from '../helpers/youtube.ts';

let lg: Instance;
beforeEach(async () => {
  lg = await startInstance();
  serveOembed(lg.web);
});
afterEach(async () => {
  await lg.stop();
});

async function signIn(token: string): Promise<Response> {
  return fetch(`${lg.url}/api/session`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token})});
}

test('the page and its script are served', async () => {
  const page = await fetch(`${lg.url}/`);
  expect(page.status).toBe(200);
  const html = await page.text();
  const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
  expect(script).toBeDefined();
  const js = await fetch(new URL(script!, lg.url));
  expect(js.status).toBe(200);
  expect(await js.text()).toContain('legenda');
});

test('a browser signs in with a you token and gets a session cookie', async () => {
  expect((await signIn('nope')).status).toBe(403);
  expect((await signIn(lg.token('agent:curator'))).status).toBe(403);
  const response = await signIn(lg.token('you'));
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const who = await (await fetch(`${lg.url}/api/whoami`, {headers: {cookie}})).json();
  expect(who).toMatchObject({ok: true, actor: 'you'});
  expect((await fetch(`${lg.url}/api/whoami`)).status).toBe(401);
});

test('an item the agent adds is pushed to an open browser', async () => {
  const cookie = (await signIn(lg.token('you'))).headers.get('set-cookie')!.split(';')[0]!;
  const controller = new AbortController();
  const stream = await fetch(`${lg.url}/api/events`, {headers: {cookie}, signal: controller.signal});
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const until = async (needle: string) => {
    while (!text.includes(needle)) {
      const {value, done} = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
  };
  await until('event: hello');

  const run = (await lg.j(['run', 'start'], {as: 'agent:curator'})).json.run.id;
  await lg.j(['suggest', 'youtube', 'https://youtu.be/aaaaaaaaaa1', '--reason', 'r', '--run', run], {as: 'agent:curator'});
  await until('"origin":"agent"');
  controller.abort();
  expect(text).toContain('"actor":"agent:curator"');
  expect(text).toContain('"entity":"item"');
});

test('history lists carry their reactions and reasons', async () => {
  const id = (await lg.j(['add', 'https://youtu.be/aaaaaaaaaa1'])).json.results[0].item.id;
  await lg.j(['done', id, '--reaction', 'liked', '--note', 'good']);
  const cookie = (await signIn(lg.token('you'))).headers.get('set-cookie')!.split(';')[0]!;
  const body = await (await fetch(`${lg.url}/api/items?state=done&feedback=1`, {headers: {cookie}})).json();
  expect(body.items[0].feedback).toEqual([{kind: 'liked', note: 'good', at: lg.clock.now}]);
});
