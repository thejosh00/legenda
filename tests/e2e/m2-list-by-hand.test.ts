/**
 * M2: the list, by hand — state transitions, structured feedback, follows, interests,
 * the profile, events on every change, and what an agent token may not do.
 */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {startInstance, type Instance} from '../helpers/instance.ts';
import {CHANNEL, serveChannel, serveOembed} from '../helpers/youtube.ts';

let lg: Instance;
const V1 = 'https://youtu.be/aaaaaaaaaa1';
const V2 = 'https://youtu.be/aaaaaaaaaa2';

beforeEach(async () => {
  lg = await startInstance();
  serveOembed(lg.web);
  await serveChannel(lg.web);
});
afterEach(async () => {
  await lg.stop();
});

async function add(url: string): Promise<string> {
  const result = await lg.j(['add', url]);
  expect(result.code).toBe(0);
  return result.json.results[0].item.id;
}

const events = () => lg.db.query('SELECT actor, entity, change FROM events ORDER BY seq').all() as Array<{actor: string; entity: string; change: string}>;

describe('state transitions', () => {
  test('add fills details from oEmbed when there is no key', async () => {
    const id = await add(V1);
    const item = (await lg.j(['show', id])).json.item;
    expect(item).toMatchObject({title: 'Video aaaaaaaaaa1', creator: 'Example Workshop', creator_external_id: CHANNEL, length_minutes: null});
  });

  test('queue → done with a reaction → restore → dismissed with a reason', async () => {
    const id = await add(V1);

    const done = await lg.j(['done', id, '--reaction', 'loved', '--note', 'superb']);
    expect(done.code).toBe(0);
    expect(done.json.item).toMatchObject({state: 'done', version: 2});
    expect(done.json.feedback[0]).toMatchObject({kind: 'loved', note: 'superb', actor: 'you'});

    expect((await lg.j(['list'])).json.items).toHaveLength(0);
    expect((await lg.j(['list', '--state', 'done'])).json.items).toHaveLength(1);

    const restored = await lg.j(['restore', id]);
    expect(restored.json.item.state).toBe('queue');

    const dismissed = await lg.j(['dismiss', id, '--reason', 'too_long']);
    expect(dismissed.json.item.state).toBe('dismissed');
    expect(dismissed.json.feedback[0].kind).toBe('too_long');

    const shown = (await lg.j(['show', id])).json;
    expect(shown.feedback.map((f: {kind: string}) => f.kind).sort()).toEqual(['loved', 'too_long']);
  });

  test('done without a reaction records no feedback; a note alone is a comment', async () => {
    const a = await add(V1);
    const b = await add(V2);
    expect((await lg.j(['done', a])).json.feedback).toEqual([]);
    expect((await lg.j(['done', b, '--note', 'ok'])).json.feedback[0].kind).toBe('comment');
  });

  test('a dismissed item is never resurrected by adding it again', async () => {
    const id = await add(V1);
    await lg.j(['dismiss', id]);
    const again = await lg.j(['add', V1]);
    expect(again.json.results[0]).toMatchObject({existing: true, item: {state: 'dismissed'}});
  });

  test('every change is an event, attributed', async () => {
    const id = await add(V1);
    await lg.j(['done', id, '--reaction', 'liked']);
    const log = events();
    expect(log.map(e => `${e.actor} ${e.entity} ${JSON.parse(e.change).kind}`)).toEqual(['you item added', 'you item state', 'you feedback liked']);
  });
});

describe('feedback kinds fit the source', () => {
  test('a YouTube item takes clickbait but not too_deep', async () => {
    const id = await add(V1);
    const wrong = await lg.j(['dismiss', id, '--reason', 'too_deep']);
    expect(wrong.code).toBe(2);
    expect(wrong.json.error).toContain('does not apply to youtube');
    expect((await lg.j(['show', id])).json.item.state).toBe('queue');
    expect((await lg.j(['dismiss', id, '--reason', 'clickbait'])).code).toBe(0);
  });

  test('reactions and reasons are not interchangeable', async () => {
    const id = await add(V1);
    expect((await lg.j(['done', id, '--reaction', 'too_long'])).code).toBe(2);
    expect((await lg.j(['dismiss', id, '--reason', 'loved'])).code).toBe(2);
    expect((await lg.j(['done', id, '--reaction', 'bogus'])).code).toBe(2);
  });

  test('more, less and comment any time', async () => {
    const id = await add(V1);
    expect((await lg.j(['feedback', id, 'more'])).json.feedback.kind).toBe('more_like_this');
    expect((await lg.j(['feedback', id, 'less', '--note', 'hmm'])).json.feedback).toMatchObject({kind: 'less_like_this', note: 'hmm'});
    expect((await lg.j(['feedback', id, 'comment'])).code).toBe(2);
    expect((await lg.j(['feedback', id, 'loved'])).code).toBe(2);
  });
});

describe('follows and blocks', () => {
  test('follow a channel by handle, list it, unfollow it', async () => {
    const followed = await lg.j(['follow', 'youtube', 'https://www.youtube.com/@exampleworkshop', '--note', 'joinery only']);
    expect(followed.code).toBe(0);
    expect(followed.json.follow).toMatchObject({source: 'youtube', kind: 'channel', external_id: CHANNEL, title: 'Example Workshop', status: 'following', fetched_by: 'app', screened: false, note: 'joinery only'});

    const again = await lg.j(['follow', 'youtube', CHANNEL]);
    expect(again.json.existing).toBe(true);

    expect((await lg.j(['follows'])).json.follows).toHaveLength(1);
    expect((await lg.j(['unfollow', followed.json.follow.id])).code).toBe(0);
    expect((await lg.j(['follows'])).json.follows).toHaveLength(0);
  });

  test('dismiss --block blocks the creator; unblock removes it', async () => {
    const id = await add(V1);
    const dismissed = await lg.j(['dismiss', id, '--reason', 'not_interested_creator', '--block']);
    expect(dismissed.code).toBe(0);
    const [block] = (await lg.j(['follows', '--status', 'blocked'])).json.follows;
    expect(block).toMatchObject({kind: 'channel', external_id: CHANNEL, status: 'blocked'});
    expect((await lg.j(['unblock', block.id])).code).toBe(0);
    expect((await lg.j(['follows'])).json.follows).toHaveLength(0);
  });

  test('block by item, and a follow that is then blocked', async () => {
    const f = (await lg.j(['follow', 'youtube', CHANNEL])).json.follow;
    const blocked = await lg.j(['block', f.id]);
    expect(blocked.json.follow.status).toBe('blocked');
    const id = await add(V1);
    expect((await lg.j(['block', id])).json.follow.id).toBe(f.id);
  });

  test('follow set changes the note and screening', async () => {
    const f = (await lg.j(['follow', 'youtube', CHANNEL])).json.follow;
    const changed = await lg.j(['follow', 'set', f.id, '--note', 'no livestreams', '--screened']);
    expect(changed.json.follow).toMatchObject({note: 'no livestreams', screened: true});
  });
});

describe('interests and the profile', () => {
  test('interests are added, listed and removed', async () => {
    const added = await lg.j(['interest', 'add', 'woodworking joinery', '--strength', 'core', '--source', 'youtube']);
    expect(added.json.interest).toMatchObject({topic: 'woodworking joinery', strength: 'core', sources: ['youtube']});
    await lg.j(['interest', 'add', 'crypto', '--strength', 'avoid']);
    expect((await lg.j(['interests'])).json.interests.map((i: {topic: string}) => i.topic)).toEqual(['woodworking joinery', 'crypto']);
    expect((await lg.j(['interest', 'rm', 'crypto'])).code).toBe(0);
    expect((await lg.j(['interest', 'add', 'x', '--strength', 'loud'])).code).toBe(2);
  });

  test('the profile is versioned with who and why', async () => {
    expect((await lg.j(['profile'])).json.profile).toBeNull();
    await lg.j(['profile', 'edit', '--stdin', '--note', 'first'], {stdin: 'Likes hand tools.'});
    const agent = await lg.j(['profile', 'set', '--stdin', '--note', 'loved two joinery videos'], {as: 'agent:curator', stdin: 'Likes hand tools, especially joinery.'});
    expect(agent.code).toBe(0);
    expect(agent.json.profile).toMatchObject({version: 2, actor: 'agent:curator'});

    const history = (await lg.j(['profile', '--history'])).json.history;
    expect(history.map((v: {version: number; actor: string}) => `${v.version} ${v.actor}`)).toEqual(['2 agent:curator', '1 you']);
  });

  test('an agent must say why it changed the profile, and keep it under the cap', async () => {
    expect((await lg.j(['profile', 'set', '--stdin'], {as: 'agent:curator', stdin: 'x'})).code).toBe(2);
    const big = await lg.j(['profile', 'set', '--stdin', '--note', 'n'], {as: 'agent:curator', stdin: 'x'.repeat(9000)});
    expect(big.code).toBe(1);
    expect(big.json.error).toContain('profile_max_bytes');
  });
});

describe('what an agent token cannot do', () => {
  const USER_ONLY: Array<(ids: {item: string; follow: string}) => string[]> = [
    () => ['add', 'https://youtu.be/aaaaaaaaaa9'],
    ({item}) => ['done', item],
    ({item}) => ['dismiss', item],
    ({item}) => ['restore', item],
    ({item}) => ['feedback', item, 'more'],
    () => ['follow', 'youtube', CHANNEL],
    ({follow}) => ['follow', 'set', follow, '--note', 'x'],
    ({follow}) => ['unfollow', follow],
    ({follow}) => ['block', follow],
    ({follow}) => ['unblock', follow],
    () => ['interest', 'add', 'anything', '--strength', 'core'],
    () => ['interest', 'rm', 'anything'],
  ];

  test('every user-only command is refused with exit 2, and changes nothing', async () => {
    const item = await add(V1);
    const follow = (await lg.j(['follow', 'youtube', CHANNEL])).json.follow.id as string;
    const before = events().length;
    for (const argv of USER_ONLY) {
      const args = argv({item, follow});
      const result = await lg.j(args, {as: 'agent:curator'});
      expect({args, code: result.code}).toEqual({args, code: 2});
      expect(result.json.error).toContain("user's to do");
    }
    expect(events().length).toBe(before);
  });

  test('an agent can read everything', async () => {
    await add(V1);
    for (const args of [['list'], ['follows'], ['interests'], ['profile']]) {
      expect((await lg.j(args, {as: 'agent:curator'})).code).toBe(0);
    }
  });
});
