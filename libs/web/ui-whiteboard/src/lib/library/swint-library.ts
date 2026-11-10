import type { LibraryItem } from '@excalidraw/excalidraw/types';
import { CLEAN_ROUGHNESS, FONT_NORMAL } from '../board-style.js';

type Shape = 'rectangle' | 'ellipse' | 'diamond' | 'line' | 'text';
interface Spec {
  type: Shape;
  x: number;
  y: number;
  w: number;
  h: number;
  extra?: Record<string, unknown>;
}
export type LibraryItemData = Omit<LibraryItem, 'elements'> & {
  elements: (Record<string, unknown> & { type: Shape; roughness: number; groupIds: string[]; fontFamily?: number })[];
};

const INK = '#1e1e1e';

function element(itemId: string, n: number, s: Spec) {
  return {
    id: `${itemId}-${n}`,
    type: s.type,
    x: s.x,
    y: s.y,
    width: s.w,
    height: s.h,
    angle: 0,
    strokeColor: INK,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: CLEAN_ROUGHNESS,
    opacity: 100,
    groupIds: [itemId],
    frameId: null,
    roundness: null,
    seed: 1 + n,
    version: 1,
    versionNonce: 1 + n,
    isDeleted: false,
    boundElements: null,
    updated: 0,
    link: null,
    locked: false,
    ...s.extra,
  };
}

const label = (text: string, x: number, y: number, w: number): Spec => ({
  type: 'text',
  x,
  y,
  w,
  h: 20,
  extra: {
    text,
    originalText: text,
    fontSize: 16,
    fontFamily: FONT_NORMAL,
    textAlign: 'center',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  },
});
const line = (x: number, y: number, dx: number, dy: number, extra: Record<string, unknown> = {}): Spec => ({
  type: 'line',
  x,
  y,
  w: Math.abs(dx),
  h: Math.abs(dy),
  extra: {
    points: [
      [0, 0],
      [dx, dy],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: null,
    ...extra,
  },
});
const fill = (color: string) => ({ backgroundColor: color, fillStyle: 'solid' });
const rounded = { roundness: { type: 3 } };
const dashed = { strokeStyle: 'dashed' };

function item(name: string, specs: Spec[]): LibraryItemData {
  const id = `swint-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return { id, name, status: 'published', created: 0, elements: specs.map((s, n) => element(id, n, s)) as LibraryItemData['elements'] };
}

/** The fixed, vendor-neutral system-design library offered on every board. */
export const SWINT_LIBRARY: LibraryItemData[] = [
  item('Client', [{ type: 'rectangle', x: 0, y: 0, w: 140, h: 90, extra: rounded }, line(0, 20, 140, 0), label('Client', 0, 45, 140)]),
  item('Mobile app', [
    { type: 'rectangle', x: 0, y: 0, w: 60, h: 100, extra: rounded },
    line(22, 88, 16, 0),
    label('Mobile app', -30, 108, 120),
  ]),
  item('User', [
    { type: 'ellipse', x: 20, y: 0, w: 40, h: 40 },
    { type: 'ellipse', x: 0, y: 44, w: 80, h: 50 },
    label('User', -10, 100, 100),
  ]),
  item('DNS', [{ type: 'rectangle', x: 0, y: 0, w: 120, h: 60, extra: { ...rounded, ...fill('#e7f5ff') } }, label('DNS', 0, 20, 120)]),
  item('CDN', [{ type: 'ellipse', x: 0, y: 0, w: 140, h: 80, extra: fill('#e7f5ff') }, label('CDN', 0, 30, 140)]),
  item('Load balancer', [{ type: 'diamond', x: 0, y: 0, w: 120, h: 100, extra: fill('#fff4e6') }, label('Load balancer', -20, 108, 160)]),
  item('API gateway', [
    { type: 'rectangle', x: 0, y: 0, w: 160, h: 70, extra: { ...rounded, ...fill('#fff4e6') } },
    { type: 'rectangle', x: 6, y: 6, w: 148, h: 58, extra: rounded },
    label('API gateway', 0, 25, 160),
  ]),
  item('Service', [
    { type: 'rectangle', x: 0, y: 0, w: 140, h: 70, extra: { ...rounded, ...fill('#ebfbee') } },
    label('Service', 0, 25, 140),
  ]),
  item('Worker', [
    { type: 'rectangle', x: 0, y: 0, w: 140, h: 70, extra: { ...rounded, ...dashed, ...fill('#ebfbee') } },
    label('Worker', 0, 25, 140),
  ]),
  item('Database', [
    { type: 'rectangle', x: 0, y: 15, w: 120, h: 80, extra: fill('#f3f0ff') },
    { type: 'ellipse', x: 0, y: 0, w: 120, h: 30, extra: fill('#f3f0ff') },
    { type: 'ellipse', x: 0, y: 80, w: 120, h: 30, extra: fill('#f3f0ff') },
    label('Database', 0, 45, 120),
  ]),
  item('Cache', [{ type: 'rectangle', x: 0, y: 0, w: 120, h: 70, extra: { ...rounded, ...fill('#fff9db') } }, label('Cache', 0, 25, 120)]),
  item('Queue', [
    { type: 'rectangle', x: 0, y: 0, w: 180, h: 50, extra: fill('#fff0f6') },
    line(45, 0, 0, 50),
    line(90, 0, 0, 50),
    line(135, 0, 0, 50),
    label('Queue', 0, 58, 180),
  ]),
  item('Pub/Sub topic', [
    { type: 'ellipse', x: 0, y: 0, w: 150, h: 70, extra: fill('#fff0f6') },
    line(150, 35, 40, -25, { endArrowhead: 'arrow' }),
    line(150, 35, 40, 25, { endArrowhead: 'arrow' }),
    label('Pub/Sub topic', 0, 25, 150),
  ]),
  item('Object storage', [
    { type: 'rectangle', x: 0, y: 0, w: 130, h: 90, extra: fill('#f8f9fa') },
    line(0, 0, 130, 0, { strokeWidth: 4 }),
    label('Object storage', -5, 35, 140),
  ]),
  item('Search index', [
    { type: 'rectangle', x: 0, y: 0, w: 140, h: 70, extra: { ...rounded, ...fill('#f3f0ff') } },
    { type: 'ellipse', x: 100, y: 10, w: 24, h: 24 },
    line(120, 32, 10, 12),
    label('Search index', 0, 40, 140),
  ]),
  item('External service', [
    { type: 'rectangle', x: 0, y: 0, w: 160, h: 70, extra: { ...rounded, ...dashed } },
    label('External service', 0, 25, 160),
  ]),
  item('Region', [{ type: 'rectangle', x: 0, y: 0, w: 360, h: 240, extra: { ...dashed, ...rounded } }, label('Region', 10, 8, 80)]),
];

/** True when `items` is exactly our library (same ids), i.e. the user has not added, imported or removed anything. */
export function isSwintLibrary(items: readonly { id: string }[]): boolean {
  if (items.length !== SWINT_LIBRARY.length) return false;
  const ours = new Set(SWINT_LIBRARY.map((i) => i.id));
  return items.every((i) => ours.has(i.id));
}
