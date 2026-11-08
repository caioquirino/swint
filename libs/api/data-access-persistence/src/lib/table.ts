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
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = item as T & Record<string, unknown>;
  return rest as Omit<T, 'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'>;
}
