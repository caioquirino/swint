import '@testing-library/jest-dom/vitest';

// jsdom has no layout; ProseMirror measures ranges when it scrolls the selection into view.
const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) } as DOMRect;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => emptyRect;
