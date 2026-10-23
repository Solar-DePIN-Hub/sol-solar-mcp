import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function start(fetchImpl?: typeof fetch) {
  const port = await freePort();
  const config = loadConfig({
    PORT: String(port),
    HOST: "127.0.0.1",
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    NODE_ENV: "test",
  });
  const { app, shutdown } = createApp(config, {
    fetch: fetchImpl,
    now: () => new Date("2026-10-18T06:00:00+03:00"),
  });
  const server = app.listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    base: `http://127.0.0.1:${port}`,
    resource: config.resourceUrl,
    async close() {
      await shutdown();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function mockFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("geocoding-api.open-meteo.com")) {
      return Response.json({
        results: [{
          name: "Kyiv", country: "Ukraine", admin1: "Kyiv City", latitude: 50.45466, longitude: 30.5238,
          timezone: "Europe/Kyiv", population: 2952301, feature_code: "PPLC",
        }],
      });
    }
    if (url.includes("api.open-meteo.com")) {
      return Response.json({
        timezone: "Europe/Kyiv",
        utc_offset_seconds: 10800,
        hourly: {
          time: ["2026-10-18T12:00", "2026-10-18T13:00", "2026-10-18T14:00", "2026-10-19T12:00", "2026-10-19T13:00"],
          global_tilted_irradiance: [800, 850, 700, 200, 180],
          temperature_2m: [15, 16, 16, 14, 14],
        },
        daily: { time: ["2026-10-18", "2026-10-19"], sunrise: ["2026-10-18T07:25", "2026-10-19T07:26"], sunset: ["2026-10-18T18:00", "2026-10-19T17:58"] },
      });
    }
    if (url.includes("re.jrc.ec.europa.eu")) {
      return Response.json({
        inputs: {
          meteo_data: { radiation_db: "PVGIS-SARAH3", year_min: 2005, year_max: 2023 },
          mounting_system: { fixed: { slope: { value: 35 }, azimuth: { value: 0 } } },
        },
        outputs: {
          monthly: { fixed: [{ month: 10, E_d: 12.78, E_m: 396.31 }] },
          totals: { fixed: { E_d: 15.26, E_y: 5570.19 } },
        },
      });
    }
    return new Response("missing mock", { status: 404 });
  }) as typeof fetch;
}

async function mint(base: string, resource: string): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${base}/`;
  const authorized = await fetch(`${base}/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    body: new URLSearchParams({
      response_type: "code",
      client_id: "sol-solar-web",
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
      scope: "solar:read",
      state: "test",
      decision: "allow",
    }),
  });
  const code = new URL(authorized.headers.get("location") ?? "http://invalid").searchParams.get("code");
  assert.ok(code);
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
  const json = await tokenResponse.json() as { access_token: string };
  return json.access_token;
}

function spoken(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((item) => item.text ?? "").join(" ");
}

describe("MCP server", () => {
  it("speaks the protocol version Alexa+ requires and answers a wash question", async () => {
    assert.ok(LATEST_PROTOCOL_VERSION >= "2025-11-25");
    const ctx = await start(mockFetch());
    try {
      const unauthenticated = await fetch(`${ctx.base}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
      });
      assert.equal(unauthenticated.status, 401);
      assert.equal(unauthenticated.headers.get("www-authenticate"), null);
      const metadata = await (await fetch(`${ctx.base}/.well-known/oauth-authorization-server`)).json() as { code_challenge_methods_supported: string[] };
      assert.ok(metadata.code_challenge_methods_supported.includes("S256"));
      const prm = await (await fetch(`${ctx.base}/.well-known/oauth-protected-resource/mcp`)).json() as { resource: string };
      assert.equal(prm.resource, ctx.resource);

      const queryToken = await fetch(`${ctx.base}/mcp?access_token=nope`, { method: "POST" });
      assert.equal(queryToken.status, 400);

      const forbidden = await fetch(`${ctx.base}/mcp`, { method: "POST", headers: { origin: "https://evil.example" } });
      assert.equal(forbidden.status, 403);

      const token = await mint(ctx.base, ctx.resource);
      const transport = new StreamableHTTPClientTransport(new URL(ctx.resource), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: "sol-solar-test", version: "1.0.0" });
      await client.connect(transport);
      assert.equal(transport.protocolVersion, "2025-11-25");
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
        "battery_through_the_night",
        "best_time_for_appliance",
        "daily_solar_briefing",
        "estimate_savings",
        "forecast_pv_production",
        "plan_the_solar_day",
        "remember_household_appliances",
        "remember_solar_site",
      ]);
      const withCard = tools.tools.filter((tool) => (tool._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri === "ui://sol-solar/solar-card.html");
      assert.equal(withCard.length, 5);
      const site = await client.callTool({
        name: "remember_solar_site",
        arguments: { place: "Kyiv", system_kw: 5, tilt_degrees: 35, azimuth_degrees: 0 },
      });
      assert.match(spoken(site), /Kyiv, Ukraine/);
      const siteId = (site as { structuredContent?: { site_id?: string } }).structuredContent?.site_id;
      assert.ok(siteId);
      const answer = await client.callTool({
        name: "best_time_for_appliance",
        arguments: { site_id: siteId, appliance_name: "washing machine", power_kw: 0.7, duration_hours: 2 },
      });
      assert.match(spoken(answer), /Run the washing machine/);
      assert.doesNotMatch(spoken(answer), /NaN|undefined/);
      const followup = await client.callTool({ name: "forecast_pv_production", arguments: {} });
      assert.match(spoken(followup), /kilowatt-hour/);
      const battery = await client.callTool({
        name: "battery_through_the_night",
        arguments: { site_id: siteId, battery_kwh: 5, charge_percent: 40, household_load_kw: 0.3 },
      });
      assert.match(spoken(battery), /battery should last|runs out/);
      assert.match(spoken(battery), /not read from a battery/);
      assert.doesNotMatch(spoken(battery), /NaN|undefined/);
      const missing = await client.callTool({ name: "forecast_pv_production", arguments: { site_id: "missing-site" } });
      assert.match(spoken(missing), /don't have that site/);
      const prompt = await client.getPrompt({ name: "answer_solar_question", arguments: { question: "When should I run the washing machine?" } });
      assert.match(prompt.messages[0]?.content.type === "text" ? prompt.messages[0].content.text : "", /washing machine/);
      await client.close();
    } finally {
      await ctx.close();
    }
  });

  it("serves the MCP App card and keeps a household across MCP sessions", async () => {
    const ctx = await start(mockFetch());
    try {
      const token = await mint(ctx.base, ctx.resource);
      const connect = async () => {
        const transport = new StreamableHTTPClientTransport(new URL(ctx.resource), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
        });
        const client = new Client({ name: "sol-solar-test", version: "1.0.0" });
        await client.connect(transport);
        return client;
      };
      const first = await connect();
      const resources = await first.listResources();
      assert.ok(resources.resources.some((item) => item.uri === "ui://sol-solar/solar-card.html"));
      const card = await first.readResource({ uri: "ui://sol-solar/solar-card.html" });
      const content = card.contents[0] as { mimeType?: string; text?: string };
      assert.equal(content.mimeType, "text/html;profile=mcp-app");
      assert.match(content.text ?? "", /ui\/initialize/);
      assert.match(content.text ?? "", /ui\/notifications\/tool-result/);
      const mirror = await fetch(`${ctx.base}/ui/solar-card.html`);
      assert.equal(await mirror.text(), content.text);
      assert.match(mirror.headers.get("content-security-policy") ?? "", /default-src 'none'/);

      const site = await first.callTool({ name: "remember_solar_site", arguments: { place: "Kyiv", system_kw: 5, tilt_degrees: 35, azimuth_degrees: 0 } });
      const siteId = (site as { structuredContent?: { site_id?: string } }).structuredContent?.site_id;
      assert.ok(siteId);
      const saved = await first.callTool({
        name: "remember_household_appliances",
        arguments: { site_id: siteId, appliances: [
          { name: "washing machine", power_kw: 0.7, duration_hours: 2 },
          { name: "dishwasher", power_kw: 1, duration_hours: 1 },
        ] },
      });
      assert.match(spoken(saved), /Saved for Kyiv, Ukraine/);
      assert.match(spoken(saved), /not read from a meter/);
      await first.close();

      // A brand-new MCP session only knows the site_id.
      const second = await connect();
      const answer = await second.callTool({ name: "best_time_for_appliance", arguments: { site_id: siteId, appliance_name: "Washing Machine" } });
      assert.match(spoken(answer), /Run the Washing Machine|Run the washing machine/i);
      assert.match(spoken(answer), /power and duration you saved/);
      assert.equal((answer as { structuredContent?: { used_saved_appliance?: boolean } }).structuredContent?.used_saved_appliance, true);
      const plan = await second.callTool({ name: "plan_the_solar_day", arguments: { site_id: siteId } });
      assert.doesNotMatch(spoken(plan), /NaN|undefined/);
      const runs = (plan as { structuredContent?: { runs?: unknown[]; unscheduled?: string[] } }).structuredContent;
      assert.equal((runs?.runs?.length ?? 0) + (runs?.unscheduled?.length ?? 0), 2);
      const unknown = await second.callTool({ name: "best_time_for_appliance", arguments: { site_id: siteId, appliance_name: "kettle" } });
      assert.equal((unknown as { isError?: boolean }).isError, true);
      assert.match(spoken(unknown), /kettle's power/);
      await second.close();
    } finally {
      await ctx.close();
    }
  });
});
