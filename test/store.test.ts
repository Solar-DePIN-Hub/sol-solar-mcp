import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeleteItemCommand, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoStore } from "../src/dynamoStore.js";

describe("DynamoDB cache", () => {
  it("writes a TTL and does not return an expired item", async () => {
    const items = new Map<string, Record<string, { S?: string; N?: string }>>();
    const client = {
      async send(command: GetItemCommand | PutItemCommand | DeleteItemCommand) {
        if (command instanceof PutItemCommand) {
          const key = command.input.Item?.pk?.S;
          if (key && command.input.Item) items.set(key, command.input.Item);
          return {};
        }
        if (command instanceof GetItemCommand) {
          const key = command.input.Key?.pk?.S;
          return { Item: key ? items.get(key) : undefined };
        }
        if (command instanceof DeleteItemCommand) {
          const key = command.input.Key?.pk?.S;
          if (key) items.delete(key);
          return {};
        }
        return {};
      },
    };
    const store = new DynamoStore(client, "sol-solar-test");
    await store.set("forecast:kyiv", "{\"ok\":true}", 60);
    const saved = items.get("forecast:kyiv");
    assert.equal(saved?.value?.S, "{\"ok\":true}");
    assert.ok(Number(saved?.ttl?.N) > Math.floor(Date.now() / 1000));
    assert.equal(await store.get("forecast:kyiv"), "{\"ok\":true}");
    saved!.ttl = { N: "1" };
    assert.equal(await store.get("forecast:kyiv"), undefined);
  });
});
