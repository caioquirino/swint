import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BOARD_ELEMENTS_KEY, getBoardElements, getNotesFragment, NOTES_FRAGMENT_KEY } from './documents.js';

describe('typed document accessors', () => {
  it('returns the same shared types as raw access', () => {
    const doc = new Y.Doc();
    expect(getBoardElements(doc)).toBe(doc.getMap(BOARD_ELEMENTS_KEY));
    expect(getNotesFragment(doc)).toBe(doc.getXmlFragment(NOTES_FRAGMENT_KEY));
  });
  it('uses the agreed keys', () => {
    expect(BOARD_ELEMENTS_KEY).toBe('elements');
    expect(NOTES_FRAGMENT_KEY).toBe('content');
  });
});
