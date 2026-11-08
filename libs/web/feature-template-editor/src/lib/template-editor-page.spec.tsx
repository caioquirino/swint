import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi, renderWithApi } from '@swint/web-data-access-api/testing';

const drawn = { id: 'e1', type: 'rectangle', version: 2, versionNonce: 3, index: 'a0', isDeleted: false, x: 0, y: 0, width: 5, height: 5 };

vi.mock('@swint/web-ui-whiteboard', () => ({
  SeedBoardEditor: ({ initialElements, onChange }: { initialElements: unknown[]; onChange: (e: unknown[]) => void }) => (
    <div>
      <span data-testid="seed-count">{initialElements.length}</span>
      <button type="button" onClick={() => onChange(initialElements)}>noop-change</button>
      <button type="button" onClick={() => onChange([...initialElements, drawn])}>draw</button>
    </div>
  ),
}));

const { TemplateEditorPage } = await import('./template-editor-page.js');

const existing = {
  id: 't1', title: 'URL shortener', instructionsMd: '# Go', rubricMd: '- x', durationMin: 45,
  hasBoardSeed: true, archived: false, createdBy: 's', createdAt: 1, updatedAt: 100,
};
const seed = { elements: [{ ...drawn, id: 'seed1', version: 1 }] };

afterEach(() => vi.restoreAllMocks());

describe('TemplateEditorPage (new)', () => {
  it('creates a template without a board when nothing was drawn', async () => {
    const create = vi.fn(async () => existing);
    renderWithApi(<TemplateEditorPage />, { api: fakeApi({ templates: { create } }), path: '/templates/new', routePath: '/templates/new' });
    await userEvent.type(screen.getByLabelText('Title'), 'Chat app');
    await userEvent.clear(screen.getByLabelText('Duration (minutes)'));
    await userEvent.type(screen.getByLabelText('Duration (minutes)'), '60');
    await userEvent.type(screen.getByLabelText('Instructions'), 'Design a chat');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        { title: 'Chat app', durationMin: 60, instructionsMd: 'Design a chat', rubricMd: '', boardSeed: null },
        expect.anything(),
      ),
    );
    expect(await screen.findByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('sends the drawn starting board', async () => {
    const create = vi.fn(async () => existing);
    renderWithApi(<TemplateEditorPage />, { api: fakeApi({ templates: { create } }), path: '/templates/new', routePath: '/templates/new' });
    await userEvent.type(screen.getByLabelText('Title'), 'Chat app');
    await userEvent.click(screen.getByRole('button', { name: 'draw' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({ boardSeed: { elements: [drawn] } });
  });

  it('validates before sending', async () => {
    const create = vi.fn();
    renderWithApi(<TemplateEditorPage />, { api: fakeApi({ templates: { create } }), path: '/templates/new', routePath: '/templates/new' });
    await userEvent.clear(screen.getByLabelText('Duration (minutes)'));
    await userEvent.type(screen.getByLabelText('Duration (minutes)'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('TemplateEditorPage (edit)', () => {
  const render = (templates: Record<string, (...a: never[]) => unknown>) =>
    renderWithApi(<TemplateEditorPage />, {
      api: fakeApi({ templates: { get: async () => existing, getSeed: async () => seed, ...templates } }),
      path: '/templates/t1',
      routePath: '/templates/:templateId',
    });

  it('loads the template and its starting board', async () => {
    render({});
    expect(await screen.findByDisplayValue('URL shortener')).toBeInTheDocument();
    expect(screen.getByTestId('seed-count')).toHaveTextContent('1');
  });

  it('keeps the current board (boardSeed null) when the board was not changed', async () => {
    const update = vi.fn(async () => existing);
    render({ update });
    await screen.findByDisplayValue('URL shortener');
    await userEvent.click(screen.getByRole('button', { name: 'noop-change' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect((update.mock.calls[0] as unknown[])[0]).toMatchObject({ id: 't1', boardSeed: null });
  });

  it('warns before overwriting a concurrent edit, and aborts if declined', async () => {
    const update = vi.fn(async () => existing);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let calls = 0;
    renderWithApi(<TemplateEditorPage />, {
      api: fakeApi({
        templates: {
          get: async () => (calls++ === 0 ? existing : { ...existing, updatedAt: 200 }),
          getSeed: async () => seed,
          update,
        },
      }),
      path: '/templates/t1',
      routePath: '/templates/:templateId',
    });
    await screen.findByDisplayValue('URL shortener');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
  });
});
