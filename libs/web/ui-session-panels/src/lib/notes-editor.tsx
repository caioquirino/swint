import { useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { getNotesFragment } from '@swint/shared-collab-protocol';

export interface NotesEditorProps {
  doc: Y.Doc;
  /** Anything with an `awareness` (the Hocuspocus provider in the app). */
  awarenessProvider: { awareness: Awareness };
  user: { name: string; color: string };
  readOnly: boolean;
  onEditor?: (editor: Editor) => void;
}

/** Shared interviewer notes (spec §2: TipTap + Collaboration + collaboration caret). */
export function NotesEditor({ doc, awarenessProvider, user, readOnly, onEditor }: NotesEditorProps) {
  const editor = useEditor(
    {
      extensions: [
        // The Collaboration extension brings its own Yjs-aware undo; TipTap's history must be off.
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ fragment: getNotesFragment(doc) }),
        CollaborationCaret.configure({ provider: awarenessProvider, user }),
      ],
      editable: !readOnly,
      editorProps: { attributes: { class: 'min-h-[12rem] p-4 text-sm outline-none', 'aria-label': 'Interviewer notes' } },
    },
    [doc, awarenessProvider],
  );

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (editor) onEditor?.(editor);
  }, [editor, onEditor]);

  return <EditorContent editor={editor} />;
}
