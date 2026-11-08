import { ORPCError, type ORPCErrorOptions } from '@orpc/client';
import type { ApiClient } from '../lib/client.js';

type AnyFn = (...args: never[]) => unknown;
export type FakeApiImpl = { [G in keyof ApiClient]?: { [P in keyof ApiClient[G]]?: AnyFn } };

/** An ApiClient whose procedures come from `impl`. Unexpected calls throw, so tests fail loudly. */
export function fakeApi(impl: FakeApiImpl): ApiClient {
  return new Proxy({} as ApiClient, {
    get(_t, group: string) {
      return new Proxy(
        {},
        {
          get(_g, proc: string) {
            const fn = (impl as Record<string, Record<string, AnyFn> | undefined>)[group]?.[proc];
            return (
              fn ??
              (() => {
                throw new Error(`unexpected api call: ${group}.${proc}`);
              })
            );
          },
        },
      );
    },
  });
}

export function orpcError(code: string, data?: unknown): ORPCError<string, unknown> {
  return new ORPCError(code, (data === undefined ? {} : { data }) as ORPCErrorOptions<unknown>);
}
