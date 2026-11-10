import { expect, test, type Page } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

const trails = (p: Page) => p.locator('.SVGLayer svg path');

test('a candidate laser trail is visible to the interviewer while the button is held', async ({ page, browser }) => {
  await signInAsInterviewer(page);
  const session = await createSession(page, uniqueCandidate());
  const candidateContext = await browser.newContext();
  const candidate = await candidateContext.newPage();
  await candidate.goto(session.candidateUrl);
  await page.goto(session.roomPath);
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(candidate.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();

  // Let the template board settle on both sides, then use it as the baseline.
  await expect(candidate.getByTestId('board')).toHaveAttribute('data-element-count', /^[1-9]\d*$/);
  await candidate.waitForTimeout(1000);
  const before = await candidate.getByTestId('board').getAttribute('data-element-count');
  await expect(trails(page)).toHaveCount(0);

  const box = await candidate.getByTestId('board').boundingBox();
  if (!box) throw new Error('board is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // The `k` shortcut did not activate the laser in the candidate's toolbar, so select it from the toolbar (the input is overlaid by its icon).
  await candidate.getByRole('checkbox', { name: 'Laser pointer' }).click({ force: true });
  await expect(candidate.getByRole('checkbox', { name: 'Laser pointer' })).toBeChecked();
  await candidate.mouse.move(x, y);
  await candidate.mouse.down();
  for (let i = 1; i <= 10; i++) await candidate.mouse.move(x + i * 20, y, { steps: 2 });

  await expect.poll(async () => trails(page).count(), { timeout: 5_000 }).toBeGreaterThan(0);

  await candidate.mouse.up();
  await expect.poll(async () => trails(page).count(), { timeout: 5_000 }).toBe(0);
  await expect(candidate.getByTestId('board')).toHaveAttribute('data-element-count', before ?? '');
  await candidateContext.close();
});
