import { expect, type Page } from '@playwright/test';
import { INTERVIEWER, KEYCLOAK_ORIGIN } from './env.js';

/** Signs in through the real Keycloak login form (spec §8: real Keycloak, no auth stub) and lands on the dashboard. */
export async function signInAsInterviewer(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForURL((url) => url.origin === KEYCLOAK_ORIGIN);
  await page.locator('#username').fill(INTERVIEWER.username);
  await page.locator('#password').fill(INTERVIEWER.password);
  await page.locator('#kc-login').click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
}
