// Test-only typings for vitest's inject(). The persistence testing module augments ProvidedContext,
// but pnpm resolves it to a different vitest peer variant than apps/api does, so the augmentation
// does not reach this project. Mirrors libs/api/data-access-persistence/src/testing/index.ts.
import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    dynamoEndpoint: string;
    s3Endpoint: string;
  }
}
