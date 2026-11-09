import { QueryCommand, type DynamoDBDocumentClient, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';

export interface Table {
  doc: DynamoDBDocumentClient;
  name: string;
}

export const GSI1 = 'GSI1';

export async function queryAll<T>(table: Table, input: Omit<QueryCommandInput, 'TableName'>): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const out = await table.doc.send(new QueryCommand({ ...input, TableName: table.name, ExclusiveStartKey }));
    items.push(...((out.Items ?? []) as T[]));
    ExclusiveStartKey = out.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Remove DynamoDB key attributes before returning a record to callers. */
export function stripKeys<T extends object>(item: T): Omit<T, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'> {
  const rest = { ...item } as Record<string, unknown>;
  for (const k of ['PK', 'SK', 'GSI1PK', 'GSI1SK']) delete rest[k];
  return rest as unknown as Omit<T, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'>;
}

/** A stored item as a typed record: key attributes removed, cast once here rather than at every call site. */
export function fromItem<T>(item: Record<string, unknown>): T {
  return stripKeys(item) as unknown as T;
}
