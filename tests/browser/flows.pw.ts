/** What a person does with legenda, through the page. */
import {expect, test} from './support.ts';

test('a video added by hand, then watched and loved, is in history with that reaction', async ({legenda, signedIn: page}) => {
  // The seed is here for its FakeWeb: YouTube's oembed answers for any video id, so nothing leaves this machine.
  await legenda.seed('everything');
  const main = page.locator('main.content');

  await page.goto(`${legenda.url}/#/add`);
  await main.locator('textarea').fill('https://youtu.be/vid00000009');
  await main.getByRole('button', {name: 'Add to the list'}).click();
  await expect(main.locator('.results li.ok')).toContainText('Added Video vid00000009');

  // On the list, as a card of its own.
  await page.goto(`${legenda.url}/#/list`);
  await page.reload();
  const card = main.locator('.card', {hasText: 'Video vid00000009'});
  await expect(card).toBeVisible();

  // Watched, and how it was.
  await card.getByRole('button', {name: 'Watched', exact: true}).click();
  await expect(card.locator('.panel-title')).toHaveText('How was it?');
  const saved = page.waitForResponse(r => /\/api\/items\/[^/]+\/done$/.test(r.url()));
  await card.locator('.chip', {hasText: 'loved'}).click();
  expect((await saved).status()).toBe(200);

  // Gone from the list, and in history with the reaction. Loaded anew: what was saved, not what the page remembers.
  await page.reload();
  await expect(main.locator('.cards .count')).toBeVisible();
  await expect(main.locator('.card', {hasText: 'Video vid00000009'})).toHaveCount(0);
  await page.goto(`${legenda.url}/#/history`);
  await page.reload();
  const done = main.locator('.card', {hasText: 'Video vid00000009'});
  await expect(done.locator('.history-line')).toContainText('Watched');
  await expect(done.locator('.history-line .pill.soft')).toContainText('loved');
});
