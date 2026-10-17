export interface Config {
  nodeEnv: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  resourceUrl: string;
  issuer: string;
  clientIds: string[];
  redirectUris: string[];
  devBearerToken?: string;
  allowedOrigins: string[];
  forecastTtlSeconds: number;
  climatologyTtlSeconds: number;
  geocodeTtlSeconds: number;
  tokenTtlSeconds: number;
  systemLossFraction: number;
  tempCoeffPerC: number;
  fetchTimeoutMs: number;
  store: "memory" | "dynamodb";
  dynamoTable?: string;
  awsRegion: string;
}

function requiredNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}`);
  }
  return value;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? "development";
  const host = env.HOST ?? "127.0.0.1";
  const port = requiredNumber(env, "PORT", 8787, 1, 65535);
  const rawBase = env.PUBLIC_BASE_URL?.trim();
  const publicBaseUrl = (rawBase ? rawBase : `http://127.0.0.1:${port}`).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(publicBaseUrl);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must be http or https");
  }

  const clientIds = ["sol-solar-web", ...splitList(env.OAUTH_CLIENT_IDS)];
  const redirectUris = new Set<string>([`${publicBaseUrl}/`, ...splitList(env.OAUTH_REDIRECT_URIS)]);
  if (nodeEnv !== "production") {
    redirectUris.add(`http://127.0.0.1:${port}/`);
    redirectUris.add(`http://localhost:${port}/`);
  }

  const devBearerToken = env.DEV_BEARER_TOKEN?.trim() || undefined;
  if (devBearerToken && devBearerToken.length < 16) {
    throw new Error("DEV_BEARER_TOKEN must be at least 16 characters");
  }

  const store = env.TOKEN_STORE === "dynamodb" ? "dynamodb" : "memory";
  const dynamoTable = env.DYNAMODB_TABLE?.trim() || undefined;
  if (store === "dynamodb" && !dynamoTable) {
    throw new Error("DYNAMODB_TABLE is required when TOKEN_STORE=dynamodb");
  }

  const allowedOrigins = new Set<string>([parsed.origin, ...splitList(env.ALLOWED_ORIGINS)]);

  return {
    nodeEnv,
    host,
    port,
    publicBaseUrl,
    resourceUrl: `${publicBaseUrl}/mcp`,
    issuer: publicBaseUrl,
    clientIds: [...new Set(clientIds)],
    redirectUris: [...redirectUris],
    devBearerToken,
    allowedOrigins: [...allowedOrigins],
    forecastTtlSeconds: requiredNumber(env, "FORECAST_TTL_SECONDS", 1800, 30, 86_400),
    climatologyTtlSeconds: requiredNumber(env, "CLIMATOLOGY_TTL_SECONDS", 604_800, 3600, 2_592_000),
    geocodeTtlSeconds: requiredNumber(env, "GEOCODE_TTL_SECONDS", 604_800, 3600, 2_592_000),
    tokenTtlSeconds: requiredNumber(env, "TOKEN_TTL_SECONDS", 43_200, 60, 604_800),
    systemLossFraction: requiredNumber(env, "SYSTEM_LOSS_FRACTION", 0.14, 0, 0.5),
    tempCoeffPerC: requiredNumber(env, "TEMP_COEFF_PER_C", -0.004, -0.01, 0),
    fetchTimeoutMs: requiredNumber(env, "FETCH_TIMEOUT_MS", 8000, 500, 20_000),
    store,
    dynamoTable,
    awsRegion: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "eu-central-1",
  };
}
