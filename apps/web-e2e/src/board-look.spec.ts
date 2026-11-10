import { expect, test } from '@playwright/test';
import { signInAsInterviewer } from './support/auth.js';
import { createSession, uniqueCandidate } from './support/sessions.js';

test('the board offers Normal/Code fonts only, clean lines only, and a fixed library', async ({ page }) => {
  await signInAsInterviewer(page);
  const session = await createSession(page, uniqueCandidate());
  await page.goto(session.roomPath);
  await page.getByRole('button', { name: 'Start interview' }).click();
  const board = page.getByTestId('board');
  await expect(board).toBeVisible();

  // Text tool: the font picker shows Normal and Code, not the hand-written font or "more fonts".
  await page.getByTestId('toolbar-text').click({ force: true });
  await expect(board.getByTestId('font-family-normal')).toBeVisible();
  await expect(board.getByTestId('font-family-code')).toBeVisible();
  await expect(board.getByTestId('font-family-hand-drawn')).toBeHidden();
  await expect(board.getByTestId('font-family-show-fonts')).toBeHidden();

  // Rectangle tool: no sloppiness control.
  await page.getByTestId('toolbar-rectangle').click({ force: true });
  // Positive control: the properties panel rendered (stroke width is shown for rectangles).
  await expect(board.getByTestId('strokeWidth-thin')).toBeVisible();
  await expect(board.locator('input[name="sloppiness"]').first()).toBeAttached();
  await expect(board.locator('fieldset:has(input[name="sloppiness"])')).toBeHidden();

  // Library: our items, no browsing or library menu.
  await board.getByRole('checkbox', { name: 'Library' }).click({ force: true });
  await expect(board.getByText('Load balancer')).toBeVisible();
  await expect(board.locator('.library-menu-browse-button')).toBeHidden();
  await expect(board.locator('.library-menu-dropdown-container')).toBeHidden();
  // Library only: no search tab switcher, no personal library (rendered by Excalidraw, hidden by our CSS).
  await expect(board.locator('.default-sidebar .sidebar-triggers')).toBeAttached();
  await expect(board.locator('.default-sidebar .sidebar-triggers')).toBeHidden();
  await expect(board.getByText('Excalidraw Library')).toBeVisible();
  await expect(board.getByText('Personal Library')).toBeAttached();
  await expect(board.getByText('Personal Library')).toBeHidden();
  await expect(board.locator('.library-menu-items__no-items')).toBeHidden();
  // Find would open the sidebar on the hidden search tab: it is blocked. Focus inside the board first
  // (Excalidraw ignores keys aimed at body); the tool click also closes the sidebar.
  await page.getByTestId('toolbar-selection').click({ force: true });
  await expect(board.locator('.default-sidebar')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(board.locator('.default-sidebar')).toHaveCount(0);
  await expect(board.locator('.layer-ui__search')).toHaveCount(0);
});
