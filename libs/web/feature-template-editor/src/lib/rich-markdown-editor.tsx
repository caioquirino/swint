import { useEffect, useId, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { MARKDOWN_PROSE } from '@swint/web-ui-session-panels';
import { EditorToolbar } from './editor-toolbar.js';
import { hasMarkdownImage, looksLikeMarkdown, templateExtensions, toMarkdown, withoutImages } from './markdown-extensions.js';

export interface RichMarkdownEditorProps {
  /** Accessible name of the editing surface. */
  label: string;
  /** Markdown, read on mount only (the editor is uncontrolled after that). */
  value: string;
  onChange: (markdown: string) => void;
  error?: string;
}

/** WYSIWYG editor that loads and reports markdown (spec §4). */
export function RichMarkdownEditor({ label, value, onChange, error }: RichMarkdownEditorProps) {
  const errorId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const errorRef = useRef(error);
  errorRef.current = error;
  const editorRef = useRef<Editor | null>(null);
  // What the stored text was at mount, and what the editor makes of it (they differ when the editor normalizes).
  const originalRef = useRef(value);
  const initialMarkdownRef = useRef<string | null>(null);
  const reportedRef = useRef(value);
  const hasImages = hasMarkdownImage(originalRef.current);

  const editor = useEditor(
    {
      extensions: templateExtensions(),
      content: withoutImages(value),
      contentType: 'markdown',
      onCreate: ({ editor: e }) => {
        initialMarkdownRef.current = toMarkdown(e);
      },
      onUpdate: ({ editor: e }) => {
        const markdown = toMarkdown(e);
        // Back at what was loaded (e.g. a selection-only transaction): keep the stored text exactly as it was.
        const next = markdown === initialMarkdownRef.current ? originalRef.current : markdown;
        if (next === reportedRef.current) return;
        reportedRef.current = next;
        onChangeRef.current(next);
      },
      editorProps: {
        // A function, so ProseMirror re-reads it on every view update (see the error effect below).
        attributes: () => ({
          'aria-label': label,
          'aria-multiline': 'true',
          class: `${MARKDOWN_PROSE} min-h-full px-6 py-4 outline-none`,
          ...(errorRef.current ? { 'aria-invalid': 'true', 'aria-describedby': errorId } : {}),
        }),
        handlePaste: (_view, event) => {
          const data = event.clipboardData;
          const current = editorRef.current;
          if (!data || !current || current.isActive('codeBlock')) return false;
          // Code editors (VS Code) add text/html next to the text; markdown source still wants the markdown path.
          if (data.types.includes('text/html') && !data.types.includes('vscode-editor-data')) return false;
          const text = data.getData('text/plain');
          if (!looksLikeMarkdown(text)) return false;
          current.commands.insertContent(text, { contentType: 'markdown' });
          return true;
        },
      },
    },
    [],
  );
  editorRef.current = editor;
  // Normally set by onCreate; captured here too so it is known before the first interaction.
  if (editor && initialMarkdownRef.current === null) initialMarkdownRef.current = toMarkdown(editor);

  // Re-apply the editing surface's attributes when the error appears or clears.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.updateState(editor.view.state);
  }, [editor, error]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorToolbar editor={editor} />
      {hasImages ? (
        <p
          role="note"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          This text contains images, which the editor can&apos;t show. They are kept unless you edit this section; editing it will remove
          them.
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}
      <EditorContent editor={editor} className="min-h-0 flex-1 overflow-auto [&>div]:min-h-full" />
    </div>
  );
}
