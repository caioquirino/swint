import type { Page } from '@playwright/test';
import { SEED_TEMPLATE } from './env.js';

export interface CreatedSession {
  roomPath: string;
  candidateUrl: string;
  interviewerUrl: string;
}

/** Creates a session from the dashboard dialog and reads both links from it. */
export async function createSession(page: Page, candidateName: string, template: string = SEED_TEMPLATE): Promise<CreatedSession> {
  await page.getByRole('button', { name: 'New session' }).click();
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await dialog.getByLabel('Template').selectOption({ label: template });
  await dialog.getByLabel('Candidate name').fill(candidateName);
  await dialog.getByRole('button', { name: 'Create session' }).click();
  const candidateUrl = await dialog.getByLabel('Candidate link').inputValue();
  const interviewerUrl = await dialog.getByLabel('Interviewer link').inputValue();
  return { candidateUrl, interviewerUrl, roomPath: new URL(interviewerUrl).pathname };
}

export const uniqueCandidate = () => `Candidate ${Date.now().toString(36)}`;
