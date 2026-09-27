import {expect, test} from 'bun:test';
import {docPageId, underBase} from '../../src/core/docs.ts';

test('under the base URL: same scheme and host, path prefix', () => {
  const base = 'https://docs.example.com/wiki';
  expect(underBase('https://docs.example.com/wiki/spaces/ENG/pages/1', base)).toBe(true);
  expect(underBase('https://docs.example.com/wikipedia/x', base)).toBe(false);
  expect(underBase('http://docs.example.com/wiki/x', base)).toBe(false);
  expect(underBase('https://evil.example.com/wiki/x', base)).toBe(false);
  expect(underBase('https://docs.example.com/wiki/x', undefined)).toBe(false);
});

test('page ids from common shapes, else the URL', () => {
  expect(docPageId('https://docs.example.com/wiki/spaces/ENG/pages/123456/Storage-RFC')).toBe('123456');
  expect(docPageId('https://docs.example.com/pages/viewpage.action?pageId=987')).toBe('987');
  expect(docPageId('https://notion.example.com/Team-Plan-0123456789abcdef0123456789ABCDEF')).toBe('0123456789abcdef0123456789abcdef');
  expect(docPageId('https://drive.example.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit')).toBe('1AbCdEfGhIjKlMnOpQrStUv');
  expect(docPageId('https://wiki.example.com/Onboarding/?x=1#top')).toBe('https://wiki.example.com/Onboarding');
});
