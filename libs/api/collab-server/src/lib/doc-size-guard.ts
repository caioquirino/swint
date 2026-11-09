/** Largest encoded Yjs document the server accepts writes into (boards hold no images in v1). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export interface DocSizeGuard {
  /** Whether a message of `bytes` may be applied to document `name`. */
  admit(name: string, bytes: number): boolean;
  /** Drops the estimate for an unloaded document. */
  forget(name: string): void;
}

/**
 * Tracks an over-estimate of each document's size (its measured size plus the bytes of every admitted message) and
 * only measures the real size (an O(document) encode) when that estimate would cross `maxBytes`.
 */
export function createDocSizeGuard(maxBytes: number, measure: (name: string) => number): DocSizeGuard {
  const estimate = new Map<string, number>();
  return {
    admit(name, bytes) {
      const base = estimate.get(name) ?? measure(name);
      if (base + bytes <= maxBytes) {
        estimate.set(name, base + bytes);
        return true;
      }
      const exact = measure(name);
      if (exact + bytes <= maxBytes) {
        estimate.set(name, exact + bytes);
        return true;
      }
      estimate.set(name, exact);
      return false;
    },
    forget(name) {
      estimate.delete(name);
    },
  };
}
