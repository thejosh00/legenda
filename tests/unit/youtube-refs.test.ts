import {describe, expect, test} from 'bun:test';
import {channelIdFromHtml, channelTitleFromHtml, parseChannelRef, parseVideoRef} from '../../src/core/youtube.ts';

const ID = 'dQw4w9WgXcQ';

describe('video refs', () => {
  test.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&t=42s`],
    [`https://m.youtube.com/watch?feature=share&v=${ID}`],
    [`https://youtu.be/${ID}?si=abc`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube.com/live/${ID}`],
    [`youtube.com/watch?v=${ID}`],
    [ID],
  ])('%s', input => {
    expect(parseVideoRef(input)).toBe(ID);
  });

  test.each([['https://vimeo.com/123'], ['https://www.youtube.com/@somebody'], ['https://www.youtube.com/watch?v=short'], ['not a url'], ['']])(
    'rejects %s',
    input => {
      expect(parseVideoRef(input)).toBeUndefined();
    },
  );
});

describe('channel refs', () => {
  const UC = 'UCabcdefghijklmnopqrstuv';
  test('ids, handles and URLs', () => {
    expect(parseChannelRef(UC)).toEqual({kind: 'id', id: UC});
    expect(parseChannelRef(`https://www.youtube.com/channel/${UC}/videos`)).toEqual({kind: 'id', id: UC});
    expect(parseChannelRef('@veritasium')).toEqual({kind: 'handle', handle: 'veritasium'});
    expect(parseChannelRef('https://youtube.com/@veritasium/featured')).toEqual({kind: 'handle', handle: 'veritasium'});
    expect(parseChannelRef('https://www.youtube.com/c/Oldname')).toEqual({kind: 'legacy', path: '/c/Oldname'});
    expect(parseChannelRef(`https://www.youtube.com/watch?v=${ID}`)).toBeUndefined();
  });

  test('channel id from page HTML', () => {
    expect(channelIdFromHtml(`<meta ...>"channelId":"${UC}","x"`)).toBe(UC);
    expect(channelIdFromHtml('<html></html>')).toBeUndefined();
  });
});

test('a channel page gives its name from og:title, entities decoded', () => {
  expect(channelTitleFromHtml('<meta property="og:title" content="Theo - t3&#8228;gg &amp; friends">')).toBe('Theo - t3․gg & friends');
  expect(channelTitleFromHtml('<html></html>')).toBeUndefined();
});
