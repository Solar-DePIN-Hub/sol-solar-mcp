import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import type { Config } from "./config.js";
import { MemoryStore, type KeyValueStore } from "./store.js";

interface DynamoSender {
  send(command: GetItemCommand | PutItemCommand | DeleteItemCommand): Promise<{
    Item?: Record<string, { S?: string; N?: string }>;
  }>;
}

export class DynamoStore implements KeyValueStore {
  constructor(
    private readonly client: DynamoSender,
    private readonly table: string,
  ) {}

  async get(key: string): Promise<string | undefined> {
    const out = await this.client.send(new GetItemCommand({
      TableName: this.table,
      Key: { pk: { S: key } },
      ConsistentRead: true,
    }));
    const value = out.Item?.value?.S;
    const ttl = out.Item?.ttl?.N;
    if (!value) return undefined;
    if (ttl && Number(ttl) * 1000 <= Date.now()) return undefined;
    return value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.send(new PutItemCommand({
      TableName: this.table,
      Item: {
        pk: { S: key },
        value: { S: value },
        ttl: { N: String(Math.floor(Date.now() / 1000) + ttlSeconds) },
      },
    }));
  }

  async take(key: string): Promise<string | undefined> {
    const value = await this.get(key);
    if (value === undefined) return undefined;
    await this.client.send(new DeleteItemCommand({
      TableName: this.table,
      Key: { pk: { S: key } },
    }));
    return value;
  }
}

export function createStore(config: Config): KeyValueStore {
  if (config.store === "dynamodb") {
    if (!config.dynamoTable) {
      throw new Error("DYNAMODB_TABLE is required when TOKEN_STORE=dynamodb");
    }
    const client = new DynamoDBClient({ region: config.awsRegion });
    return new DynamoStore(client, config.dynamoTable);
  }
  return new MemoryStore();
}
