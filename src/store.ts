export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  take(key: string): Promise<string | undefined>;
}

interface MemoryItem {
  value: string;
  expires: number;
}

export class MemoryStore implements KeyValueStore {
  private readonly items = new Map<string, MemoryItem>();

  async get(key: string): Promise<string | undefined> {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (item.expires <= Date.now()) {
      this.items.delete(key);
      return undefined;
    }
    return item.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.items.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }

  async take(key: string): Promise<string | undefined> {
    const value = await this.get(key);
    if (value === undefined) return undefined;
    this.items.delete(key);
    return value;
  }
}

export async function cachedJson<T>(
  store: KeyValueStore,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await store.get(key);
  if (hit) {
    return JSON.parse(hit) as T;
  }
  const value = await load();
  await store.set(key, JSON.stringify(value), ttlSeconds);
  return value;
}
