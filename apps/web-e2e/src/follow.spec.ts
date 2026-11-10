import { expect, test } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

test('an interviewer following the candidate sees the candidate viewport move', async ({ page, browser }) => {
  await signInAsInterviewer(page);
  const session = await createSession(page, uniqueCandidate());
  const candidateContext = await browser.newContext();
  try {
    const candidate = await candidateContext.newPage();
    await candidate.goto(session.candidateUrl);
    await page.goto(session.roomPath);
    await page.getByRole('button', { name: 'Start interview' }).click();
    const board = page.getByTestId('board');
    await expect(candidate.getByTestId('board')).toBeVisible();
    await expect(board).toBeVisible();
    const zoom = board.locator('.reset-zoom-button');
    await expect(zoom).toHaveText('100%');

    // Follow the candidate from their avatar (the only collaborator on the interviewer's board).
    await board.locator('.UserList__collaborator--avatar-only .Avatar').first().click();
    await expect(board.locator('.follow-mode')).toBeVisible();

    // Let the initial fit settle, then zoom on the candidate side: the interviewer's view follows.
    await page.waitForTimeout(1000);
    const followed = await zoom.textContent();
    const candidateZoomIn = candidate.getByTestId('board').locator('.zoom-in-button');
    for (let i = 0; i < 3; i++) await candidateZoomIn.click();
    await expect(candidate.getByTestId('board').locator('.reset-zoom-button')).toHaveText('130%');
    await expect.poll(async () => zoom.textContent(), { timeout: 5_000 }).not.toBe(followed);
  } finally {
    await candidateContext.close();
  }
});
