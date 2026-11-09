import { describe, expect, it } from 'vitest';
import { isValidBoardElement } from './board-validation.js';

const rect = {
  id: 'r1',
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  angle: 0,
  version: 1,
  versionNonce: 5,
  index: 'a0',
  isDeleted: false,
  groupIds: [],
  boundElements: null,
  strokeColor: '#000',
};

describe('isValidBoardElement', () => {
  it('accepts well-formed elements and keeps unknown fields', () => {
    expect(isValidBoardElement(rect)).toBe(true);
    expect(
      isValidBoardElement({
        ...rect,
        type: 'arrow',
        points: [
          [0, 0],
          [5, 5],
        ],
        boundElements: [{ id: 't', type: 'text' }],
      }),
    ).toBe(true);
    expect(isValidBoardElement({ ...rect, isDeleted: true, index: null })).toBe(true);
  });
  it.each([
    ['missing id', { ...rect, id: '' }],
    ['image (disabled in v1)', { ...rect, type: 'image' }],
    ['unknown type', { ...rect, type: 'iframe-of-doom' }],
    ['NaN coordinate', { ...rect, x: Number.NaN }],
    ['infinite size', { ...rect, width: Number.POSITIVE_INFINITY }],
    ['string version', { ...rect, version: '2' }],
    ['zero version', { ...rect, version: 0 }],
    ['bad points', { ...rect, type: 'line', points: [[0, 'a']] }],
    ['bad boundElements', { ...rect, boundElements: [{ id: 1 }] }],
    ['not an object', 'rectangle'],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isValidBoardElement(value)).toBe(false);
  });
});
