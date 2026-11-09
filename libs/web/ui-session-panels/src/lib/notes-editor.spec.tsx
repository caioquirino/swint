import { describe, expect, it } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { Editor } from '@tiptap/react';
import { getNotesFragment } from '@swint/shared-collab-protocol';
import { NotesEditor } from './notes-editor.js';

function linkedDocs() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
  b.on('update', (u: Uint8Array) => Y.applyUpdate(a, u));
  return { a, b };
}

describe('NotesEditor', () => {
  it('writes into the notes fragment and syncs to a peer document', async () => {
    const { a, b } = linkedDocs();
    let editor = null as Editor | null;
    render(
      <NotesEditor
        doc={a}
        awarenessProvider={{ awareness: new Awareness(a) }}
        user={{ name: 'Ada', color: '#1971c2' }}
        readOnly={false}
        onEditor={(e) => (editor = e)}
      />,
    );
    await act(async () => undefined);
    act(() => {
      editor?.commands.insertContent('hello notes');
    });
    expect(getNotesFragment(b).toString()).toContain('hello notes');
  });

  it('is not editable when read-only', async () => {
    const doc = new Y.Doc();
    let editor = null as Editor | null;
    render(
      <NotesEditor
        doc={doc}
        awarenessProvider={{ awareness: new Awareness(doc) }}
        user={{ name: 'Ada', color: '#1971c2' }}
        readOnly
        onEditor={(e) => (editor = e)}
      />,
    );
    await act(async () => undefined);
    expect(editor?.isEditable).toBe(false);
  });
});

describe('NotesEditor user changes', () => {
  it('updates the collaboration caret user without recreating the editor', async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const props = { doc, awarenessProvider: { awareness }, readOnly: false };
    const { rerender } = render(<NotesEditor {...props} user={{ name: 'Ada', color: '#111111' }} />);
    await waitFor(() => expect(awareness.getLocalState()?.['user']).toMatchObject({ name: 'Ada' }));
    rerender(<NotesEditor {...props} user={{ name: 'Grace', color: '#222222' }} />);
    await waitFor(() => expect(awareness.getLocalState()?.['user']).toMatchObject({ name: 'Grace', color: '#222222' }));
  });
});
