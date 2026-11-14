/**
 * The fixtures every browser test uses: its own legenda instance, a browser signed in to it, and a
 * failure for anything the page complains about, whether or not the test was looking.
 */
import AxeBuilder from '@axe-core/playwright';
import {test as base, expect, type Page} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

/** When every instance starts: the helpers' T0, so the page's clock and the server's agree. */
const T0 = '2026-09-12T15:00:00Z';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export interface Legenda {
  url: string;
  token: string;
  /** Put content in the instance: a name from seeds.ts. */
  seed(name: string): Promise<any>;
}

export const test = base.extend<{legenda: Legenda; signedIn: Page; complaints: string[]; offHost: string[]}>({
  legenda: async ({}, use) => {
    const env: Record<string, string | undefined> = {...process.env, TZ: 'America/Chicago'};
    delete env['LEGENDA_DIR'];
    delete env['LEGENDA_TOKEN'];
    delete env['LEGENDA_URL'];
    const child = spawn('bun', [join(import.meta.dirname, 'instance.ts')], {cwd: join(import.meta.dirname, '../..'), env, stdio: ['pipe', 'pipe', 'inherit']});
    const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
    const next = async () => JSON.parse((await lines.next()).value as string);
    const send = async (command: object) => {
      child.stdin.write(`${JSON.stringify(command)}\n`);
      const answer = await next();
      if (answer.error) throw new Error(answer.error);
      return answer.ok;
    };
    const {url, token} = await next();
    await use({url, token, seed: name => send({seed: name})});
    child.stdin.write(`${JSON.stringify({stop: true})}\n`);
    await new Promise(resolve => child.once('exit', resolve));
  },

  /**
   * Nothing the page asks for leaves this machine: a request to any host but the instance (a
   * video's thumbnail, say) is answered here with a 1x1 picture, and listed for the test to see.
   */
  offHost: [
    async ({page, legenda}, use) => {
      const asked: string[] = [];
      await page.route(
        url => !url.href.startsWith(legenda.url),
        route => {
          asked.push(route.request().url());
          return route.fulfill({status: 200, contentType: 'image/png', body: PNG});
        },
      );
      await use(asked);
    },
    {auto: true},
  ],

  /** Console errors, uncaught exceptions and failed requests. Checked after every test, while the instance still runs. */
  complaints: [
    async ({page, legenda: _running}, use) => {
      const seen: string[] = [];
      page.on('pageerror', error => seen.push(`uncaught: ${error.message}`));
      page.on('console', message => {
        if (message.type() === 'error') seen.push(`console: ${message.text()}`);
      });
      page.on('response', response => {
        if (response.status() >= 400) seen.push(`${response.status()} ${response.url()}`);
      });
      await use(seen);
      expect(seen, 'the page complained').toEqual([]);
    },
    {auto: true},
  ],

  signedIn: async ({page, legenda}, use) => {
    await page.clock.setFixedTime(new Date(T0));
    await page.goto(`${legenda.url}/?token=${legenda.token}`);
    await expect(page.locator('.tabs-top, .tabs-bottom').first()).toBeAttached();
    await use(page);
  },
});

/**
 * What every page must hold to, whatever it shows: no serious accessibility violation, and a
 * picture of it in `.playwright/gallery` for a person to look at.
 */
export async function pageHolds(page: Page, testInfo: {project: {name: string}}, name: string, options: {axeDisableRules?: string[]} = {}) {
  const axe = new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).disableRules(options.axeDisableRules ?? []);
  const {violations} = await axe.analyze();
  const serious = violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  expect.soft(serious, `${name}: accessibility`).toEqual([]);

  const dir = join(import.meta.dirname, '../../.playwright/gallery', testInfo.project.name);
  mkdirSync(dir, {recursive: true});
  await page.screenshot({path: join(dir, `${name}.png`), fullPage: true});
}

export {expect};
