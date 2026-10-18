import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createApp, isAllowedOrigin, listen } from "../src/http.js";
import { clearUpstreamCache, runtime } from "../src/runtime.js";

const originalNow = runtime.now;
const originalFetch = runtime.fetchJson.bind(runtime);
let server: Server;
let baseUrl = "";

before(async () => {
  runtime.now = () => Date.parse("2026-10-18T06:00:00.000Z");
  runtime.fetchJson = async (url: string) => fixtureFor(url);
  const app = createApp({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [],
    upstreamTimeoutMs: 5000,
  });
  server = await listen(app, "127.0.0.1", 0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind a port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  runtime.now = originalNow;
  runtime.fetchJson = originalFetch;
  clearUpstreamCache();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("the SDK advertises MCP spec 2025-11-25 or later", () => {
  assert.equal(LATEST_PROTOCOL_VERSION, "2025-11-25");
});

test("initialize negotiates the 2025-11-25 protocol over Streamable HTTP", async () => {
  const response = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "http-test", version: "1.0.0" },
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  const body = (await response.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
  assert.equal(body.result.protocolVersion, "2025-11-25");
  assert.equal(body.result.serverInfo.name, "sol-solar");
});

test("a browser origin that is not local is rejected", async () => {
  const response = await post(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { origin: "https://evil.example" },
  );
  assert.equal(response.status, 403);
  assert.equal(isAllowedOrigin("http://127.0.0.1:6274", []), true);
  assert.equal(isAllowedOrigin("https://evil.example", []), false);
});

test("GET /mcp is 405 and GET /health reports the protocol", async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  const healthBody = (await health.json()) as { protocol: string; transport: string };
  assert.equal(healthBody.protocol, "2025-11-25");
  assert.equal(healthBody.transport, "streamable-http");
  const sse = await fetch(`${baseUrl}/mcp`);
  assert.equal(sse.status, 405);
});

test("the official client can list and call the five tools", async () => {
  const client = new Client({ name: "sol-solar-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "best_appliance_hours",
      "estimate_savings",
      "forecast_pv_production",
      "resolve_location",
      "typical_monthly_yield",
    ]);
    for (const tool of listed.tools) {
      assert.ok(tool.description && tool.description.length > 40);
    }

    const location = await client.callTool({ name: "resolve_location", arguments: { place: "Kyiv" } });
    const locationText = textOf(location);
    assert.match(locationText, /Kyiv, Kyiv City, Ukraine/);

    const forecast = await client.callTool({
      name: "forecast_pv_production",
      arguments: { latitude: 50.45, longitude: 30.52, peak_power_kw: 5, place_name: "Kyiv" },
    });
    const forecastText = textOf(forecast);
    assert.match(forecastText, /still today/);
    assert.match(forecastText, /not a meter reading/);

    const appliance = await client.callTool({
      name: "best_appliance_hours",
      arguments: {
        latitude: 50.45,
        longitude: 30.52,
        peak_power_kw: 5,
        power_watts: 2000,
        duration_hours: 2,
        appliance_name: "washing machine",
      },
    });
    assert.match(textOf(appliance), /12:00–14:00/);
    assert.match(textOf(appliance), /covers the load/);

    const savings = await client.callTool({
      name: "estimate_savings",
      arguments: { production_kwh: 10, grid_price_per_kwh: 2, currency: "EUR" },
    });
    assert.match(textOf(savings), /20\.00 EUR/);
    assert.match(textOf(savings), /not a bill/);

    const year = await client.callTool({
      name: "typical_monthly_yield",
      arguments: { latitude: 50.45, longitude: 30.52, peak_power_kw: 5, tilt_degrees: 35, azimuth_degrees: 0 },
    });
    assert.match(textOf(year), /5563 kWh per year/);
    assert.match(textOf(year), /not a forecast for this year/);

    const invalid = await client.callTool({
      name: "forecast_pv_production",
      arguments: { latitude: 120, longitude: 0, peak_power_kw: 5 },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
  }
});

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function textOf(result: { content?: Array<{ text?: string }> }): string {
  return (result.content ?? []).map((item) => item.text ?? "").join("\n");
}

function fixtureFor(url: string): unknown {
  const parsed = new URL(url);
  if (parsed.hostname === "geocoding-api.open-meteo.com") {
    return {
      results: [
        {
          name: "Kyiv",
          country: "Ukraine",
          country_code: "UA",
          admin1: "Kyiv City",
          latitude: 50.45466,
          longitude: 30.5238,
          timezone: "Europe/Kyiv",
          elevation: 187,
        },
      ],
    };
  }
  if (parsed.hostname === "api.open-meteo.com") {
    const hours = [
      hour("2026-10-18T09:00", 0, 8),
      hour("2026-10-18T10:00", 100, 10),
      hour("2026-10-18T13:00", 800, 15),
      hour("2026-10-18T14:00", 700, 16),
      hour("2026-10-18T18:00", 20, 12),
      hour("2026-10-19T13:00", 500, 14),
    ];
    return {
      latitude: 50.45,
      longitude: 30.52,
      timezone: "Europe/Kyiv",
      utc_offset_seconds: 10800,
      elevation: 169,
      hourly: {
        time: hours.map((item) => item.time),
        global_tilted_irradiance: hours.map((item) => item.gti),
        temperature_2m: hours.map((item) => item.temp),
      },
    };
  }
  if (parsed.hostname === "re.jrc.ec.europa.eu") {
    return {
      inputs: {
        location: { latitude: 50.45, longitude: 30.52, elevation: 169 },
        meteo_data: { radiation_db: "PVGIS-SARAH3", meteo_db: "ERA5", year_min: 2005, year_max: 2023 },
        mounting_system: { fixed: { slope: { value: 35 }, azimuth: { value: 0 }, type: "free-standing" } },
        pv_module: { technology: "c-Si", peak_power: 5, system_loss: 14 },
      },
      outputs: {
        monthly: {
          fixed: [
            { month: 6, E_d: 23.47, E_m: 704.21, "H(i)_d": 6.14, SD_m: 34.84 },
            { month: 12, E_d: 4.31, E_m: 133.53, "H(i)_d": 1.01, SD_m: 34.58 },
          ],
        },
        totals: {
          fixed: { E_d: 15.24, E_m: 463.61, E_y: 5563.34, "H(i)_y": 1394.8, SD_y: 240.67 },
        },
      },
    };
  }
  throw new Error(`Unexpected upstream URL ${url}`);
}

function hour(time: string, gti: number, temp: number) {
  return { time, gti, temp };
}
