const CACHE_LIMIT = 100;

interface CacheEntry {
  expiresAt: number;
  body: unknown;
}

const cache = new Map<string, CacheEntry>();

export interface FetchJsonOptions {
  timeoutMs?: number;
  cacheTtlMs?: number;
}

export const runtime = {
  now(): number {
    return Date.now();
  },
  async fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? 12_000;
    const cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000;
    const cached = cache.get(url);
    if (cached && cached.expiresAt > runtime.now()) {
      return cached.body;
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            accept: "application/json",
            "user-agent": "sol-solar-mcp/1.0.0 (hackathon; +https://github.com/Solar-DePIN-Hub/sol-solar-mcp)",
          },
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Upstream ${response.status} from ${safeHost(url)}`);
          continue;
        }
        const text = await response.text();
        if (!response.ok) {
          throw new Error(`Upstream ${response.status} from ${safeHost(url)}: ${text.slice(0, 240)}`);
        }
        let body: unknown;
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          throw new Error(`Upstream from ${safeHost(url)} did not return JSON`);
        }
        if (cacheTtlMs > 0) {
          if (cache.size >= CACHE_LIMIT) {
            cache.clear();
          }
          cache.set(url, { expiresAt: runtime.now() + cacheTtlMs, body });
        }
        return body;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Upstream ")) {
          throw error;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error(`Upstream request failed for ${safeHost(url)}`);
  },
};

export function clearUpstreamCache(): void {
  cache.clear();
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "upstream";
  }
}
