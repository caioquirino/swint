import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getBoardElements } from '@swint/shared-collab-protocol';
import { buildInitialBoardUpdate } from './initial-board.js';

describe('buildInitialBoardUpdate', () => {
  it('encodes the seed elements into the board map', () => {
    const update = buildInitialBoardUpdate({
      elements: [
        { id: 'e1', type: 'rectangle', version: 3, versionNonce: 9, index: 'a0', isDeleted: false, x: 1 },
        { id: 'e2', type: 'text' },
      ],
    });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    const board = getBoardElements(doc);
    expect(board.get('e1')).toMatchObject({ id: 'e1', version: 3, versionNonce: 9, index: 'a0', x: 1 });
    // missing sync fields get safe defaults
    expect(board.get('e2')).toMatchObject({ id: 'e2', version: 1, versionNonce: 0, index: null, isDeleted: false });
  });

  it('an empty seed yields a decodable empty board', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, buildInitialBoardUpdate({ elements: [] }));
    expect(getBoardElements(doc).size).toBe(0);
  });
});
