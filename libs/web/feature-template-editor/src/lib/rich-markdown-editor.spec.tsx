import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { RichMarkdownEditor } from './rich-markdown-editor.js';

afterEach(() => vi.restoreAllMocks());

function setup(value = '', error?: string) {
  const onChange = vi.fn<(markdown: string) => void>();
  const view = render(<RichMarkdownEditor label="Instructions" value={value} onChange={onChange} error={error} />);
  const box = screen.getByRole('textbox', { name: 'Instructions' });
  // TipTap exposes the editor on its DOM node; tests drive content and selection through it.
  const editor = (box as HTMLElement & { editor: Editor }).editor;
  const last = () => onChange.mock.calls.at(-1)?.[0];
  return { ...view, onChange, box, editor, last };
}
const button = (name: string) => screen.getByRole('button', { name });

describe('RichMarkdownEditor', () => {
  it('loads markdown as rich content', () => {
    setup('# Task\n\n- one');
    expect(screen.getByRole('heading', { name: 'Task' })).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('one');
  });

  it('reports markdown on every change', () => {
    const { editor, last } = setup();
    act(() => {
      editor.commands.insertContent('Hello');
    });
    expect(last()).toBe('Hello');
  });

  it('applies formatting from the toolbar and shows it as pressed', async () => {
    const { editor, last } = setup();
    act(() => {
      editor.commands.insertContent('Hello');
      editor.commands.selectAll();
    });
    expect(button('Bold')).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button('Bold'));
    expect(last()).toBe('**Hello**');
    expect(button('Bold')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(button('Heading 2'));
    expect(last()).toBe('## **Hello**');
    // The editor appends an empty trailing paragraph, so select-all spans two blocks; put the cursor in the heading.
    act(() => {
      editor.commands.setTextSelection(2);
    });
    expect(button('Heading 2')).toHaveAttribute('aria-pressed', 'true');
  });

  it('turns a paragraph into a task list', async () => {
    const { editor, last } = setup();
    act(() => {
      editor.commands.insertContent('Hello');
    });
    await userEvent.click(button('Task list'));
    expect(last()).toBe('- [ ] Hello');
  });

  it('disables table actions outside a table, and edits a table inside one', async () => {
    const { last } = setup();
    for (const name of ['Add row', 'Delete row', 'Add column', 'Delete column', 'Delete table']) expect(button(name)).toBeDisabled();
    await userEvent.click(button('Insert table'));
    expect(last()).toBe('|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |');
    expect(button('Add row')).toBeEnabled();
    await userEvent.click(button('Add row'));
    expect(last()?.split('\n')).toHaveLength(5);
    await userEvent.click(button('Delete table'));
    expect(last()).toBe('');
  });

  it('rejects disallowed link protocols, sets allowed links and removes a link on an empty answer', async () => {
    const { editor, last } = setup('site');
    act(() => {
      editor.commands.selectAll();
    });
    // eslint-disable-next-line no-script-url -- the test needs a disallowed protocol
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('javascript:alert(1)');
    await userEvent.click(button('Link'));
    expect(screen.getByRole('alert')).toHaveTextContent('Links must start with http://, https:// or mailto:');
    expect(last()).toBeUndefined();
    prompt.mockReturnValue('https://example.com');
    await userEvent.click(button('Link'));
    expect(last()).toBe('[site](https://example.com)');
    expect(screen.queryByRole('alert')).toBeNull();
    prompt.mockReturnValue('');
    await userEvent.click(button('Link'));
    expect(last()).toBe('site');
  });

  it('parses pasted markdown into rich content', () => {
    const { box, last } = setup();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? '## Pasted\n\n- [ ] item' : '') },
    });
    act(() => {
      box.dispatchEvent(paste);
    });
    expect(screen.getByRole('heading', { name: 'Pasted' })).toBeInTheDocument();
    expect(last()).toContain('## Pasted');
    expect(last()).toContain('- [ ] item');
  });

  it('marks the editing surface invalid while there is an error', () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichMarkdownEditor label="Rubric" value="" onChange={onChange} error="Too long" />);
    const box = screen.getByRole('textbox', { name: 'Rubric' });
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Too long');
    rerender(<RichMarkdownEditor label="Rubric" value="" onChange={onChange} />);
    expect(box).not.toHaveAttribute('aria-invalid');
  });

  describe('existing content', () => {
    const LEGACY = '#### x\n\n![a](https://b/c.png)\n\n- item';

    it('keeps heading levels 4 to 6', () => {
      const { editor } = setup('#### Four');
      expect(screen.getByRole('heading', { name: 'Four' })).toHaveProperty('tagName', 'H4');
      expect(editor.getMarkdown().trim()).toBe('#### Four');
    });

    it('does not report a change when the editor is only focused or selected', () => {
      const { editor, onChange } = setup(LEGACY);
      act(() => {
        editor.commands.focus();
        editor.commands.setTextSelection(2);
        editor.commands.selectAll();
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('reports the original text when an edit is undone back to it', () => {
      const { editor, last } = setup('# T\n\n1) a');
      act(() => {
        editor.commands.insertContentAt(1, 'x');
      });
      expect(last()).not.toBe('# T\n\n1) a');
      act(() => {
        (editor.commands as unknown as { undo: () => boolean }).undo();
      });
      expect(last()).toBe('# T\n\n1) a');
    });

    it('reports the new markdown after a real edit', () => {
      const { editor, last } = setup(LEGACY);
      act(() => {
        editor.commands.insertContentAt(1, 'new ');
      });
      expect(last()).toContain('#### new x');
    });

    it('notes that images will be removed on edit, only when there are images', () => {
      const { unmount } = setup(LEGACY);
      expect(screen.getByRole('note')).toHaveTextContent(
        "This text contains images, which the editor can't show. They are kept unless you edit this section; editing it will remove them.",
      );
      unmount();
      setup('# no images here');
      expect(screen.queryByRole('note')).toBeNull();
    });
  });

  describe('paste', () => {
    function paste(box: HTMLElement, types: string[], text: string) {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { types, getData: (type: string) => (type === 'text/plain' ? text : '') },
      });
      act(() => {
        box.dispatchEvent(event);
      });
    }

    it('leaves HTML clipboards to the default handler', () => {
      const { box } = setup();
      paste(box, ['text/plain', 'text/html'], '## x');
      expect(screen.queryByRole('heading')).toBeNull();
    });

    it('parses markdown copied from a code editor even though it carries text/html', () => {
      const { box } = setup();
      paste(box, ['text/plain', 'text/html', 'vscode-editor-data'], '## x');
      expect(screen.getByRole('heading', { name: 'x' })).toBeInTheDocument();
    });

    it('pastes literally inside a code block', () => {
      const { box, editor } = setup('```\n\n```');
      act(() => {
        editor.commands.setTextSelection(1);
      });
      expect(editor.isActive('codeBlock')).toBe(true);
      paste(box, ['text/plain'], '## x');
      expect(screen.queryByRole('heading')).toBeNull();
    });

    it('does not intercept plain text that is not markdown', () => {
      const { box } = setup();
      paste(box, ['text/plain'], 'just words');
      expect(screen.queryByRole('heading')).toBeNull();
    });
  });
});
