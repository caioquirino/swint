import { expect, test, type Page } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { KEYCLOAK_ORIGIN } from './support/env.js';
import { createSession, uniqueCandidate, type CreatedSession } from './support/sessions.js';

async function startLiveSession(page: Page): Promise<CreatedSession> {
  await signInAsInterviewer(page);
  const session = await createSession(page, uniqueCandidate());
  await page.goto(session.roomPath);
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page.getByRole('button', { name: 'End interview' })).toBeVisible();
  return session;
}

test('a candidate whose link is replaced is shown the invalid-link screen; only the new link works', async ({ page, browser }) => {
  const session = await startLiveSession(page);
  const candidateContext = await browser.newContext();
  const candidate = await candidateContext.newPage();
  await candidate.goto(session.candidateUrl);
  await expect(candidate.getByTestId('board')).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'New candidate link' }).click();
  const newLink = await page.getByRole('dialog', { name: 'New candidate link' }).getByLabel('Candidate link').inputValue();

  // The open socket is closed with 4403 invite_revoked.
  await expect(candidate.getByRole('heading', { name: 'This link is no longer valid' })).toBeVisible();
  await expect(candidate.getByText('A newer invitation link was issued')).toBeVisible();

  const freshContext = await browser.newContext();
  const fresh = await freshContext.newPage();
  await fresh.goto(session.candidateUrl);
  await expect(fresh).toHaveURL(/\/link-invalid\?reason=invite_revoked$/);
  await fresh.goto(newLink);
  await expect(fresh.getByTestId('board')).toBeVisible();

  await candidateContext.close();
  await freshContext.close();
});

test('cancelling ends the interview for the candidate (4403 session_ended)', async ({ page, browser }) => {
  const session = await startLiveSession(page);
  const candidateContext = await browser.newContext();
  const candidate = await candidateContext.newPage();
  await candidate.goto(session.candidateUrl);
  await expect(candidate.getByTestId('board')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel interview' });
  await dialog.getByLabel('Reason (optional, private)').fill('e2e: candidate no-show');
  await dialog.getByRole('button', { name: 'Cancel interview' }).click();

  await expect(candidate.getByRole('heading', { name: 'The interview has ended' })).toBeVisible();
  await expect(candidate.getByText('e2e: candidate no-show')).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveText('Interview ended');
  await candidateContext.close();
});

test('signing out in another tab takes an open room away (revalidation → 401 at upgrade → REST probe)', async ({ page }) => {
  // The server revalidates every COLLAB_REVALIDATE_MS (2 s when Playwright starts the servers, 60 s otherwise).
  test.setTimeout(240_000);
  await startLiveSession(page);
  await expect(page.getByTestId('board')).toBeVisible();

  const other = await page.context().newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Sign out' }).click();
  await other.waitForURL((url) => url.origin === KEYCLOAK_ORIGIN);

  await expect(page.getByRole('heading', { name: 'Sign in to join this interview' })).toBeVisible({ timeout: 150_000 });
});
