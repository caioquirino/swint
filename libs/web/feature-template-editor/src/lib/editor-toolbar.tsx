import { useState, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { isAllowedLinkUrl } from './markdown-extensions.js';

const BUTTON =
  'inline-flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-40 ' +
  'aria-pressed:bg-blue-100 aria-pressed:text-blue-800 dark:text-slate-200 dark:hover:bg-slate-800 dark:aria-pressed:bg-blue-900/60 dark:aria-pressed:text-blue-200';
const DIVIDER = 'mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700';
export const LINK_ERROR = 'Links must start with http://, https:// or mailto:';

interface ToolProps {
  label: string;
  onRun: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

function Tool({ label, onRun, pressed, disabled, children }: ToolProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={BUTTON}
      // Keep the editor's selection: the click must not move focus out of it first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
    >
      {children}
    </button>
  );
}

/** Formatting toolbar for a template editor (spec §4). */
export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [linkError, setLinkError] = useState(false);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            h1: e.isActive('heading', { level: 1 }),
            h2: e.isActive('heading', { level: 2 }),
            h3: e.isActive('heading', { level: 3 }),
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            strike: e.isActive('strike'),
            code: e.isActive('code'),
            bulletList: e.isActive('bulletList'),
            orderedList: e.isActive('orderedList'),
            taskList: e.isActive('taskList'),
            blockquote: e.isActive('blockquote'),
            codeBlock: e.isActive('codeBlock'),
            link: e.isActive('link'),
            inTable: e.isActive('table'),
            canBold: e.can().toggleBold(),
            canItalic: e.can().toggleItalic(),
            canStrike: e.can().toggleStrike(),
            canCode: e.can().toggleCode(),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });
  if (!editor || !s) return null;
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => {
    setLinkError(false);
    fn(editor.chain().focus()).run();
  };

  const editLink = () => {
    const current = (editor.getAttributes('link') as { href?: string }).href;
    const answer = window.prompt('Link URL (http, https or mailto)', current ?? 'https://');
    if (answer === null) return;
    const url = answer.trim();
    if (url === '') {
      setLinkError(false);
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!isAllowedLinkUrl(url)) {
      setLinkError(true);
      return;
    }
    setLinkError(false);
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
      <div role="group" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
        <Tool label="Heading 1" pressed={s.h1} onRun={run((c) => c.toggleHeading({ level: 1 }))}>
          H1
        </Tool>
        <Tool label="Heading 2" pressed={s.h2} onRun={run((c) => c.toggleHeading({ level: 2 }))}>
          H2
        </Tool>
        <Tool label="Heading 3" pressed={s.h3} onRun={run((c) => c.toggleHeading({ level: 3 }))}>
          H3
        </Tool>
        <span className={DIVIDER} aria-hidden="true" />
        <Tool label="Bold" pressed={s.bold} disabled={!s.canBold} onRun={run((c) => c.toggleBold())}>
          <b>B</b>
        </Tool>
        <Tool label="Italic" pressed={s.italic} disabled={!s.canItalic} onRun={run((c) => c.toggleItalic())}>
          <i>I</i>
        </Tool>
        <Tool label="Strikethrough" pressed={s.strike} disabled={!s.canStrike} onRun={run((c) => c.toggleStrike())}>
          <s>S</s>
        </Tool>
        <Tool label="Inline code" pressed={s.code} disabled={!s.canCode} onRun={run((c) => c.toggleCode())}>
          {'</>'}
        </Tool>
        <span className={DIVIDER} aria-hidden="true" />
        <Tool label="Bullet list" pressed={s.bulletList} onRun={run((c) => c.toggleBulletList())}>
          •
        </Tool>
        <Tool label="Numbered list" pressed={s.orderedList} onRun={run((c) => c.toggleOrderedList())}>
          1.
        </Tool>
        <Tool label="Task list" pressed={s.taskList} onRun={run((c) => c.toggleTaskList())}>
          ☑
        </Tool>
        <Tool label="Quote" pressed={s.blockquote} onRun={run((c) => c.toggleBlockquote())}>
          ❝
        </Tool>
        <Tool label="Code block" pressed={s.codeBlock} onRun={run((c) => c.toggleCodeBlock())}>
          {'{ }'}
        </Tool>
        <Tool label="Link" pressed={s.link} onRun={editLink}>
          Link
        </Tool>
        <span className={DIVIDER} aria-hidden="true" />
        <div role="group" aria-label="Table" className="flex items-center gap-0.5">
          <Tool label="Insert table" onRun={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}>
            ⊞
          </Tool>
          <Tool label="Add row" disabled={!s.inTable} onRun={run((c) => c.addRowAfter())}>
            +row
          </Tool>
          <Tool label="Delete row" disabled={!s.inTable} onRun={run((c) => c.deleteRow())}>
            −row
          </Tool>
          <Tool label="Add column" disabled={!s.inTable} onRun={run((c) => c.addColumnAfter())}>
            +col
          </Tool>
          <Tool label="Delete column" disabled={!s.inTable} onRun={run((c) => c.deleteColumn())}>
            −col
          </Tool>
          <Tool label="Delete table" disabled={!s.inTable} onRun={run((c) => c.deleteTable())}>
            ✕
          </Tool>
        </div>
        <span className={DIVIDER} aria-hidden="true" />
        <Tool label="Undo" disabled={!s.canUndo} onRun={run((c) => c.undo())}>
          ↶
        </Tool>
        <Tool label="Redo" disabled={!s.canRedo} onRun={run((c) => c.redo())}>
          ↷
        </Tool>
      </div>
      {linkError ? (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
          {LINK_ERROR}
        </p>
      ) : null}
    </div>
  );
}
