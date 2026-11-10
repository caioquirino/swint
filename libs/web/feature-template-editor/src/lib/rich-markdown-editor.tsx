import { useEffect, useId, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { MARKDOWN_PROSE } from '@swint/web-ui-session-panels';
import { EditorToolbar } from './editor-toolbar.js';
import { looksLikeMarkdown, templateExtensions, toMarkdown } from './markdown-extensions.js';

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

  const editor = useEditor(
    {
      extensions: templateExtensions(),
      content: value,
      contentType: 'markdown',
      onUpdate: ({ editor: e }) => onChangeRef.current(toMarkdown(e)),
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
          if (!data || !current || data.types.includes('text/html')) return false;
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

  // Re-apply the editing surface's attributes when the error appears or clears.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.updateState(editor.view.state);
  }, [editor, error]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorToolbar editor={editor} />
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
