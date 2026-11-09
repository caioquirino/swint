/**
 * Awareness updates carry client-chosen clientIDs. Hocuspocus records which clientIDs each connection has
 * introduced (`Document.getClients(connection)`), so a connection may only touch IDs it owns or that nobody owns yet.
 * Foreign entries are dropped from the inbound update before it is applied or broadcast.
 */
export interface OwnershipView {
  /** ClientIDs the sending connection already owns. */
  own: ReadonlySet<number>;
  /** True when a different connection on the same document owns the clientID. */
  ownedByOther(clientId: number): boolean;
}

export function dropForeignClients(view: OwnershipView, states: Map<number, Record<string, unknown>>, removedClients: Set<number>): void {
  for (const clientId of [...states.keys()]) {
    if (!view.own.has(clientId) && view.ownedByOther(clientId)) states.delete(clientId);
  }
  // A removal is honoured only for the sender's own clients.
  for (const clientId of [...removedClients]) {
    if (!view.own.has(clientId)) removedClients.delete(clientId);
  }
}
