import { expect, test } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

test('a template authored with the WYSIWYG editor shows its table and checklist in the room', async ({ page }) => {
  await signInAsInterviewer(page);
  const title = `E2E template ${Date.now().toString(36)}`;
  try {
    await page.getByRole('link', { name: 'New template' }).click();
    await page.getByLabel('Title').fill(title);

    // Instructions: a heading, a checklist and a table, all from the toolbar.
    await page.getByRole('textbox', { name: 'Instructions' }).click();
    await page.getByRole('button', { name: 'Heading 1' }).click();
    await page.keyboard.type('Design a cache');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Task list' }).click();
    await page.keyboard.type('Ask about eviction');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // an empty item leaves the list
    await page.getByRole('button', { name: 'Insert table' }).click();
    for (const cell of ['Area', 'Weak', 'Strong', 'Scale']) {
      await page.keyboard.type(cell);
      await page.keyboard.press('Tab');
    }

    // Starting board: one rectangle.
    await page.getByRole('tab', { name: 'Starting board' }).click();
    const seed = page.getByTestId('seed-board');
    await expect(seed).toBeVisible();
    await seed.getByTestId('toolbar-rectangle').click({ force: true });
    const box = await seed.boundingBox();
    if (!box) throw new Error('seed board is not visible');
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();

    await page.getByRole('button', { name: 'Save template' }).click();
    await expect(page.getByRole('heading', { name: 'Interviews' })).toBeVisible();

    // The room renders the markdown with GFM, and the board starts from the seed.
    const session = await createSession(page, uniqueCandidate(), title);
    await page.goto(session.roomPath);
    await page.getByRole('button', { name: 'Start interview' }).click();
    await expect(page.getByRole('heading', { name: 'Design a cache' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Area' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Scale' })).toBeVisible();
    const checkbox = page.getByRole('checkbox', { name: /Ask about eviction/ }).or(page.locator('.task-list-item input[type=checkbox]'));
    await expect(checkbox.first()).toBeDisabled();
    await expect(page.getByTestId('board')).toHaveAttribute('data-element-count', '1');
  } finally {
    // Leave the user's dev data as it was: archive the template this test created.
    await page.goto('/');
    const archive = page.getByRole('button', { name: `Archive ${title}` });
    if (await archive.count()) {
      page.once('dialog', (dialog) => void dialog.accept());
      await archive.click();
      await expect(archive).toHaveCount(0);
    }
  }
});
