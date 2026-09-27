import {expect, test} from 'bun:test';
import {resolveDataDir} from '../../src/config.ts';
import {parseEnabledSources} from '../../src/core/settings.ts';

test('data dir: flag, then LEGENDA_DIR, then ~/.legenda', () => {
  const base = {home: '/home/u', cwd: '/work'};
  expect(resolveDataDir({...base, env: {}})).toBe('/home/u/.legenda');
  expect(resolveDataDir({...base, env: {LEGENDA_DIR: '~/work-legenda'}})).toBe('/home/u/work-legenda');
  expect(resolveDataDir({...base, env: {LEGENDA_DIR: '/x'}, flag: 'rel'})).toBe('/work/rel');
});

test('enabled sources keep a fixed order and drop unknowns', () => {
  expect(parseEnabledSources('docs, papers,bogus')).toEqual(['papers', 'docs']);
  expect(parseEnabledSources('')).toEqual([]);
});
