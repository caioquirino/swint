import type { Identity } from '@swint/api-util-rpc';

export interface CollabLogger {
  debug(o: object, m?: string): void;
  info(o: object, m?: string): void;
  warn(o: object, m?: string): void;
  error(o: object, m?: string): void;
}

export interface CollabContext {
  identity: Identity;
}
