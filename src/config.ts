export interface ServerConfig {
  host: string;
  port: number;
  /** When set, the Host header must match one of these hostnames. */
  allowedHosts?: string[];
  /** Extra browser origins allowed to call /mcp. Localhost is always allowed. */
  allowedOrigins: string[];
  upstreamTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.HOST?.trim() || "127.0.0.1";
  const port = parsePort(env.PORT ?? "3000");
  const allowedHosts = parseList(env.ALLOWED_HOSTS);
  const allowedOrigins = parseList(env.ALLOWED_ORIGINS) ?? [];
  const upstreamTimeoutMs = parsePositiveInt(env.UPSTREAM_TIMEOUT_MS ?? "12000", "UPSTREAM_TIMEOUT_MS");
  return {
    host,
    port,
    ...(allowedHosts ? { allowedHosts } : {}),
    allowedOrigins,
    upstreamTimeoutMs,
  };
}

function parsePort(value: string): number {
  return parsePositiveInt(value, "PORT", 65535);
}

function parsePositiveInt(value: string, name: string, max = 120_000): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > max) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return parsed;
}

function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}
