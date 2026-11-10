import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeApi, renderWithApi } from '@swint/web-data-access-api/testing';

const drawn = { id: 'e1', type: 'rectangle', version: 2, versionNonce: 3, index: 'a0', isDeleted: false, x: 0, y: 0, width: 5, height: 5 };
const refresh = vi.fn();

vi.mock('@swint/web-ui-whiteboard', () => ({
  SeedBoardEditor: ({
    initialElements,
    onChange,
    onReady,
  }: {
    initialElements: unknown[];
    onChange: (e: unknown[]) => void;
    onReady?: (h: { refresh(): void }) => void;
  }) => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => onReady?.({ refresh }), []);
    return (
      <div>
        <span data-testid="seed-count">{initialElements.length}</span>
        <button type="button" onClick={() => onChange(initialElements)}>
          noop-change
        </button>
        <button type="button" onClick={() => onChange([...initialElements, drawn])}>
          draw
        </button>
      </div>
    );
  },
}));

vi.mock('./rich-markdown-editor.js', () => ({
  RichMarkdownEditor: ({
    label,
    value,
    onChange,
    error,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    error?: string;
  }) => (
    <>
      <textarea aria-label={label} defaultValue={value} onChange={(e) => onChange(e.target.value)} />
      {error ? <p role="alert">{error}</p> : null}
    </>
  ),
}));

const { TemplateEditorPage } = await import('./template-editor-page.js');

const existing = {
  id: 't1',
  title: 'URL shortener',
  instructionsMd: '# Go',
  rubricMd: '- x',
  durationMin: 45,
  hasBoardSeed: true,
  archived: false,
  createdBy: 's',
  createdAt: 1,
  updatedAt: 100,
};
const seed = { elements: [{ ...drawn, id: 'seed1', version: 1 }] };

afterEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
});

describe('TemplateEditorPage (new)', () => {
  it('creates a template without a board when nothing was drawn', async () => {
    const create = vi.fn(async () => existing);
    renderWithApi(<TemplateEditorPage />, { api: fakeApi({ templates: { create } }), path: '/templates/new', routePath: '/templates/new' });
    await userEvent.type(screen.getByLabelText('Title'), 'Chat app');
    await userEvent.clear(screen.getByLabelText('Duration (minutes)'));
    await userEvent.type(screen.getByLabelText('Duration (minutes)'), '60');
    await userEvent.type(screen.getByRole('textbox', { name: 'Instructions' }), 'Design a chat');
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
    await userEvent.click(screen.getByRole('tab', { name: 'Starting board' }));
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
    await userEvent.click(screen.getByRole('tab', { name: 'Starting board' }));
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

  it('overwrites after the user confirms a concurrent edit', async () => {
    const update = vi.fn(async () => existing);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    let calls = 0;
    render({ get: async () => (calls++ === 0 ? existing : { ...existing, updatedAt: 200 }), update });
    await screen.findByDisplayValue('URL shortener');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalled();
  });

  it('keeps the original baseline when cached query data changes while mounted', async () => {
    const update = vi.fn(async () => existing);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    let calls = 0;
    const { queryClient } = renderWithApi(<TemplateEditorPage />, {
      api: fakeApi({
        templates: { get: async () => (calls++ === 0 ? existing : { ...existing, updatedAt: 200 }), getSeed: async () => seed, update },
      }),
      path: '/templates/t1',
      routePath: '/templates/:templateId',
    });
    await screen.findByDisplayValue('URL shortener');
    act(() => {
      queryClient.setQueriesData({ queryKey: [['templates', 'get']] }, { ...existing, updatedAt: 200 });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
  });
});

describe('TemplateEditorPage (layout)', () => {
  const renderNew = (path = '/templates/new', templates: Record<string, (...a: never[]) => unknown> = {}) =>
    renderWithApi(<TemplateEditorPage />, { api: fakeApi({ templates }), path, routePath: '/templates/new' });
  const tab = (name: string) => screen.getByRole('tab', { name });

  it('shows one section at a time and keeps the others mounted', async () => {
    renderNew();
    expect(tab('Instructions')).toHaveAttribute('aria-selected', 'true');
    const instructions = screen.getByRole('textbox', { name: 'Instructions' });
    expect(instructions).toBeVisible();
    await userEvent.type(instructions, 'abc');
    expect(screen.getByRole('textbox', { name: 'Rubric', hidden: true })).not.toBeVisible();
    await userEvent.click(tab('Rubric'));
    expect(screen.getByRole('textbox', { name: 'Rubric' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Instructions', hidden: true })).not.toBeVisible();
    await userEvent.click(tab('Instructions'));
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveValue('abc');
  });

  it('reads the tab from the URL, falls back on unknown values, and writes it back', async () => {
    renderNew('/templates/new?tab=rubric');
    expect(tab('Rubric')).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tab('Starting board'));
    expect(screen.getByTestId('location')).toHaveTextContent('/templates/new?tab=board');
  });

  it('falls back to Instructions for an unknown tab', () => {
    renderNew('/templates/new?tab=nope');
    expect(tab('Instructions')).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between tabs with the arrow, Home and End keys', async () => {
    renderNew();
    tab('Instructions').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Rubric')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Rubric')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(tab('Starting board')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Instructions')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Starting board')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(tab('Instructions')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Rubric')).toHaveAttribute('tabindex', '-1');
  });

  it('re-measures the board when its tab is shown', async () => {
    renderNew();
    await waitFor(() => expect(screen.getByTestId('seed-count')).toBeInTheDocument());
    refresh.mockClear();
    await userEvent.click(tab('Starting board'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('marks tabs with errors and opens the first one on save', async () => {
    const create = vi.fn();
    renderNew('/templates/new?tab=board', { create });
    await userEvent.type(screen.getByLabelText('Title'), 'Too long rubric');
    fireEvent.change(screen.getByRole('textbox', { name: 'Rubric', hidden: true }), { target: { value: 'x'.repeat(50_001) } });
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(tab('Rubric')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Rubric')).toHaveAccessibleDescription('has an error');
    expect(tab('Instructions')).not.toHaveAccessibleDescription('has an error');
    expect(create).not.toHaveBeenCalled();
  });
});
