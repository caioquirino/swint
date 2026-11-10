import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { drawRectangle } from './support/board.js';
import { KEYCLOAK_ORIGIN } from './support/env.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

const FONT = '/fonts/Excalifont/Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2';

test('interviewer and candidate run a whole interview', async ({ page, browser, baseURL }) => {
  // Everything must come from the app origin or Keycloak: no CDN (fonts are self-hosted).
  const allowed = new Set([new URL(baseURL ?? '').origin, KEYCLOAK_ORIGIN]);
  const foreign: string[] = [];
  const track = (p: Page) =>
    p.on('request', (r) => {
      const u = new URL(r.url());
      if ((u.protocol === 'http:' || u.protocol === 'https:') && !allowed.has(u.origin)) foreign.push(r.url());
    });
  track(page);

  await signInAsInterviewer(page);
  const candidateName = uniqueCandidate();
  const session = await createSession(page, candidateName);

  const candidateContext = await browser.newContext();
  const candidate = await candidateContext.newPage();
  track(candidate);
  await candidate.goto(session.candidateUrl);
  await expect(candidate.getByRole('heading', { name: 'Waiting for your interviewer to start' })).toBeVisible();

  await page.goto(session.roomPath);
  await expect(page.getByRole('tab', { name: 'Rubric' })).toBeVisible();
  await page.getByRole('button', { name: 'Start interview' }).click();

  // The waiting room polls REST and moves into the live room once started.
  await expect(candidate.getByTestId('board')).toBeVisible();
  await expect(candidate.getByRole('tab', { name: 'Rubric' })).toHaveCount(0);
  await expect(candidate.getByRole('tab', { name: 'Notes' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Participants' })).toContainText(candidateName);
  await expect(candidate.getByRole('list', { name: 'Participants' })).toContainText('Interviewer');

  // Candidate draws; the interviewer's board receives it live.
  // The template's starting board is the user's data and may change: count relative to what the interviewer's board shows once synced.
  const elementCount = async (p: Page) => Number(await p.getByTestId('board').getAttribute('data-element-count'));
  let last = -1;
  let stableSince = 0;
  await expect
    .poll(
      async () => {
        const n = await elementCount(page);
        if (n !== last) {
          last = n;
          stableSince = Date.now();
        }
        return n > 0 && Date.now() - stableSince >= 1000;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const baseline = last;
  await expect(candidate.getByTestId('board')).toHaveAttribute('data-element-count', String(baseline));
  await drawRectangle(candidate);
  await expect(candidate.getByTestId('board')).toHaveAttribute('data-element-count', String(baseline + 1));
  await expect(page.getByTestId('board')).toHaveAttribute('data-element-count', String(baseline + 1));

  // Extend by 10 minutes.
  const minutesLeft = async () => Number(/(\d+):\d{2} left/.exec((await page.getByRole('timer').textContent()) ?? '')?.[1] ?? NaN);
  await expect.poll(minutesLeft).toBeLessThanOrEqual(45);
  const before = await minutesLeft();
  await page.getByRole('button', { name: '+10 min' }).click();
  await expect.poll(minutesLeft).toBeGreaterThanOrEqual(before + 9);

  // End: the candidate's socket is closed with 4403 session_ended.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'End interview' }).click();
  await expect(candidate.getByRole('heading', { name: 'The interview has ended' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('Interview ended');

  // Export the board and check the candidate's rectangle is in it.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export .excalidraw' }).click();
  const file = await (await download).path();
  const scene = JSON.parse(await readFile(file, 'utf8')) as { elements: { type: string; isDeleted?: boolean }[] };
  // The rectangle baseline is not observable before the draw, so check the total (baseline + 1) and that the newest element is a rectangle.
  const live = scene.elements.filter((e) => !e.isDeleted);
  expect(live).toHaveLength(baseline + 1);
  expect(live.at(-1)?.type).toBe('rectangle');

  // Revisit later: read-only room with export, no controls.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start interview' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End interview' })).toHaveCount(0);

  expect((await page.request.get(FONT)).status()).toBe(200);
  expect(foreign).toEqual([]);
  await candidateContext.close();
});
