import { QueryClient } from '@tanstack/react-query';
import { isClientError } from './errors.js';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: (count, err) => !isClientError(err) && count < 2, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
