/**
 * M1: add a video by URL, list it back, and dedup across URL forms.
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {startInstance, type Instance} from '../helpers/instance.ts';

const ID = 'dQw4w9WgXcQ';
let lg: Instance;

beforeEach(async () => {
  lg = await startInstance();
});
afterEach(async () => {
  await lg.stop();
});

describe('add and list', () => {
  test('a YouTube URL round-trips through add and list', async () => {
    const added = await lg.j(['add', `https://www.youtube.com/watch?v=${ID}`]);
    expect(added.code).toBe(0);
    expect(added.stderr).toBe('');
    expect(added.json.ok).toBe(true);
    expect(added.json.results[0]).toMatchObject({ok: true, existing: false, item: {source: 'youtube', external_id: ID, origin: 'you', added_by: 'you', state: 'queue'}});

    const listed = await lg.j(['list']);
    expect(listed.code).toBe(0);
    expect(listed.json.items).toHaveLength(1);
    expect(listed.json.items[0]).toMatchObject({external_id: ID, url: `https://www.youtube.com/watch?v=${ID}`});
  });

  test('the same video by two URL forms is one item, the second add existing', async () => {
    const first = await lg.j(['add', `https://www.youtube.com/watch?v=${ID}&t=10s`]);
    const second = await lg.j(['add', `https://youtu.be/${ID}`]);
    expect(second.code).toBe(0);
    expect(second.json.results[0].existing).toBe(true);
    expect(second.json.results[0].item.id).toBe(first.json.results[0].item.id);
    expect((await lg.j(['list'])).json.items).toHaveLength(1);
  });

  test('every item field is present, unset ones as null', async () => {
    await lg.j(['add', `https://youtu.be/${ID}`]);
    const [item] = (await lg.j(['list'])).json.items;
    for (const key of ['creator_external_id', 'container', 'published', 'length_minutes', 'thumbnail', 'abstract', 'summary', 'follow_id', 'reason']) {
      expect(item).toHaveProperty(key, null);
    }
    expect(item.extra).toEqual({});
    expect(item.version).toBe(1);
  });

  test('show finds an item by id prefix or URL', async () => {
    const id = (await lg.j(['add', `https://youtu.be/${ID}`])).json.results[0].item.id as string;
    expect((await lg.j(['show', id.slice(0, 9)])).json.item.id).toBe(id);
    expect((await lg.j(['show', `https://www.youtube.com/shorts/${ID}`])).json.item.id).toBe(id);
    const missing = await lg.j(['show', 'zzzzzzzz']);
    expect(missing.code).toBe(3);
    expect(missing.json).toMatchObject({ok: false, code: 3});
  });
});

describe('the envelope and exit codes', () => {
  test('a link no enabled source recognises is a usage error, as JSON on stdout', async () => {
    const result = await lg.j(['add', 'https://vimeo.com/12345']);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(result.json).toMatchObject({ok: false, code: 2});
    expect(result.json.error).toContain('not a link');
  });

  test('a disabled source is invisible', async () => {
    await lg.cli(['add', `https://youtu.be/${ID}`]);
    lg.db.query("INSERT INTO settings (key, value) VALUES ('enabled_sources', 'papers')").run();
    expect((await lg.j(['list'])).json.items).toEqual([]);
    expect((await lg.j(['add', `https://youtu.be/${ID}`])).code).toBe(2);
  });

  test('unknown commands and options exit 2', async () => {
    expect((await lg.j(['frobnicate'])).code).toBe(2);
    const bad = await lg.j(['list', '--colour', 'red']);
    expect(bad.code).toBe(2);
    expect(bad.json.error).toContain('--colour');
  });

  test('an unreachable server exits 4', async () => {
    const result = await lg.cli(['list', '--json'], {env: {LEGENDA_URL: 'http://127.0.0.1:1'}});
    expect(result.code).toBe(4);
    expect(result.json).toMatchObject({ok: false, code: 4});
  });

  test('a bad token exits 2 with a hint', async () => {
    const result = await lg.cli(['list', '--json'], {env: {LEGENDA_TOKEN: 'nope'}});
    expect(result.code).toBe(2);
    expect(result.json.hint).toContain('legenda token');
  });

  test('human output goes to stdout, failures to stderr', async () => {
    const ok = await lg.cli(['add', `https://youtu.be/${ID}`]);
    expect(ok.stdout).toContain('added');
    const bad = await lg.cli(['show', 'nothing-here']);
    expect(bad.code).toBe(3);
    expect(bad.stdout).toBe('');
    expect(bad.stderr).toContain('legenda:');
  });
});

describe('tokens and login', () => {
  test('token issues a token for an actor, and refuses a malformed one', async () => {
    const good = await lg.j(['token', 'agent:scout']);
    expect(good.code).toBe(0);
    expect(good.json.token).toStartWith('lg_');
    expect((await lg.j(['token', 'Robert'])).code).toBe(2);
  });

  test('login writes client.json, which the CLI then uses without env', async () => {
    const token = lg.token('you');
    const login = await lg.cli(['login', '--url', lg.url, '--token', token, '--json'], {env: {LEGENDA_URL: '', LEGENDA_TOKEN: ''}});
    expect(login.code).toBe(0);
    expect(login.json.actor).toBe('you');
    const listed = await lg.cli(['list', '--json'], {env: {LEGENDA_URL: '', LEGENDA_TOKEN: ''}});
    expect(listed.code).toBe(0);
  });

  test('the version', async () => {
    const result = await lg.cli(['--version']);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
