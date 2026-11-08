import type * as Y from 'yjs';

/** Minimal shape of an Excalidraw element that the sync layer relies on. */
export interface SyncedElement {
  id: string;
  version: number;
  versionNonce: number;
  index: string | null;
  isDeleted: boolean;
  [key: string]: unknown;
}

export const BOARD_ELEMENTS_KEY = 'elements';
export const NOTES_FRAGMENT_KEY = 'content';

export function getBoardElements(doc: Y.Doc): Y.Map<SyncedElement> {
  return doc.getMap<SyncedElement>(BOARD_ELEMENTS_KEY);
}

export function getNotesFragment(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(NOTES_FRAGMENT_KEY);
}
