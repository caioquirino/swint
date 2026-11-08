import { GetObjectCommand, NoSuchKey, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export interface BlobStore {
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  putBytes(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  getBytes(key: string): Promise<Uint8Array | null>;
}

export const blobKeys = {
  templateSeed: (orgId: string, templateId: string, seedId: string) =>
    `orgs/${orgId}/templates/${templateId}/seed-${seedId}.excalidraw.json`,
  sessionBoardLatest: (orgId: string, sessionId: string) => `orgs/${orgId}/sessions/${sessionId}/board/latest.bin`,
  sessionBoardCheckpoint: (orgId: string, sessionId: string, ts: number) =>
    `orgs/${orgId}/sessions/${sessionId}/board/checkpoints/${ts}.bin`,
  sessionNotesLatest: (orgId: string, sessionId: string) => `orgs/${orgId}/sessions/${sessionId}/notes/latest.bin`,
} as const;

export function createBlobStore(s3: S3Client, bucket: string): BlobStore {
  async function getRaw(key: string): Promise<Uint8Array | null> {
    try {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return out.Body ? await out.Body.transformToByteArray() : null;
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  return {
    async putJson(key, value) {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(value), ContentType: 'application/json' }),
      );
    },
    async getJson<T>(key: string) {
      const bytes = await getRaw(key);
      return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : null;
    },
    async putBytes(key, bytes, contentType = 'application/octet-stream') {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    getBytes: getRaw,
  };
}
