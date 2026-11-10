import { expect, test } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

test('candidates get no board menu, interviewers get only Save to and Export image', async ({ page, browser }) => {
  await signInAsInterviewer(page);
  const session = await createSession(page, uniqueCandidate());
  await page.goto(session.roomPath);
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page.getByTestId('board')).toBeVisible();

  const candidateContext = await browser.newContext();
  try {
    const candidate = await candidateContext.newPage();
    await candidate.goto(session.candidateUrl);
    await expect(candidate.getByTestId('board')).toBeVisible();
    // Positive control: the toolbar rendered, the menu trigger is hidden.
    await expect(candidate.getByTestId('toolbar-rectangle')).toBeVisible();
    await expect(candidate.getByTestId('main-menu-trigger')).toBeHidden();
    // Export-to-file shortcut is blocked: no dialog opens.
    await candidate.getByTestId('board').click({ position: { x: 300, y: 300 } });
    await candidate.keyboard.press('Control+Shift+E');
    await candidate.waitForTimeout(300);
    await expect(candidate.locator('.Modal')).toHaveCount(0);
  } finally {
    await candidateContext.close();
  }

  await page.getByTestId('main-menu-trigger').click({ force: true });
  // Excalidraw spells these with three dots.
  const menu = page.getByTestId('dropdown-menu');
  await expect(menu.getByRole('button', { name: 'Save to...' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Export image...' })).toBeVisible();
  for (const gone of ['Open', 'Reset the canvas', 'Help', 'Dark mode', 'Find on canvas']) {
    await expect(menu.getByRole('button', { name: gone })).toHaveCount(0);
  }
});

test('the theme switch is global, persists, drives the board and follows the system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await signInAsInterviewer(page);
  const html = page.locator('html');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(html).toHaveClass(/dark/);

  const session = await createSession(page, uniqueCandidate());
  await page.goto(session.roomPath);
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page.locator('.excalidraw.theme--dark')).toBeVisible();

  await page.getByRole('radio', { name: 'System' }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(page.locator('.excalidraw.theme--dark')).toHaveCount(0);
});
