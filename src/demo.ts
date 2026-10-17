import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface DemoOptions {
  base: string;
  price?: number;
  currency?: string;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function textOf(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) return "";
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  return content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n");
}

function structuredOf(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || !("structuredContent" in result)) return {};
  const value = (result as { structuredContent?: unknown }).structuredContent;
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

async function mintToken(base: string, resource: string): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${base}/`;
  const state = randomBytes(8).toString("hex");
  const body = new URLSearchParams({
    response_type: "code",
    client_id: "sol-solar-web",
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    scope: "solar:read",
    state,
    decision: "allow",
  });
  const authorized = await fetch(`${base}/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  const location = authorized.headers.get("location");
  if (!location) throw new Error(`Authorization did not redirect (HTTP ${authorized.status})`);
  const code = new URL(location).searchParams.get("code");
  if (!code) throw new Error("Authorization redirect did not include a code");
  const tokenResponse = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: "sol-solar-web",
      redirect_uri: redirectUri,
      resource,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Token request failed (HTTP ${tokenResponse.status})`);
  const tokenJson = await tokenResponse.json() as { access_token?: string };
  if (!tokenJson.access_token) throw new Error("Token response had no access_token");
  return tokenJson.access_token;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const elapsed = Date.now() - started;
  const spoken = textOf(result);
  if (!spoken || spoken.includes("NaN") || spoken.includes("undefined")) {
    throw new Error(`Tool ${name} returned an unusable answer`);
  }
  console.log(`\n${name}  (${elapsed} ms)`);
  console.log(spoken);
  return result;
}

async function main(): Promise<void> {
  const options: DemoOptions = {
    base: (arg("--base-url") ?? process.env.SOL_SOLAR_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, ""),
    price: arg("--price") ? Number(arg("--price")) : undefined,
    currency: arg("--currency"),
  };
  if (options.price !== undefined && !Number.isFinite(options.price)) {
    throw new Error("--price must be a number");
  }
  const configResponse = await fetch(`${options.base}/client-config`);
  if (!configResponse.ok) {
    throw new Error(`Cannot reach ${options.base}. Start the server with npm run dev.`);
  }
  const config = await configResponse.json() as { resource: string };
  const token = await mintToken(options.base, config.resource);
  if (process.argv.includes("--token-only")) {
    console.log(token);
    return;
  }
  const transport = new StreamableHTTPClientTransport(new URL(config.resource), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "sol-solar-demo", version: "1.0.0" });
  await client.connect(transport);
  console.log("Sol Solar live MCP call");
  console.log(`Server: ${config.resource}`);
  console.log(`Protocol: ${transport.protocolVersion ?? "unknown"}`);
  console.log("Transport: Streamable HTTP");
  console.log("Place: Kyiv. Array: 5 kW. Tilt: 35 degrees facing south.");
  console.log("Appliance assumption: washing machine, 0.7 kW for 2 hours. Not a meter reading.");
  if (options.price !== undefined) {
    console.log(`Example price typed for this run: ${options.price} ${options.currency ?? ""}. Not a tariff lookup.`.trim());
  }

  const siteArgs: Record<string, unknown> = {
    place: "Kyiv",
    system_kw: 5,
    tilt_degrees: 35,
    azimuth_degrees: 0,
  };
  if (options.price !== undefined && options.currency) {
    siteArgs.price_per_kwh = options.price;
    siteArgs.currency = options.currency;
  }
  const site = await call(client, "remember_solar_site", siteArgs);
  const siteId = structuredOf(site).site_id;
  await call(client, "best_time_for_appliance", {
    site_id: siteId,
    appliance_name: "washing machine",
    power_kw: 0.7,
    duration_hours: 2,
  });
  const first = Date.now();
  await call(client, "forecast_pv_production", { site_id: siteId });
  const cold = Date.now() - first;
  const second = Date.now();
  await call(client, "forecast_pv_production", { site_id: siteId });
  console.log(`\nRepeat forecast calls after the appliance tool had filled the cache: ${cold} ms and ${Date.now() - second} ms.`);
  if (options.price !== undefined) {
    await call(client, "estimate_savings", {
      site_id: siteId,
      appliance_name: "washing machine",
      power_kw: 0.7,
      duration_hours: 2,
    });
  }
  await client.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
