import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, listen } from "../src/http.js";
import { describeLocation, describeTypicalYear } from "../src/solar/service.js";

let server: Server | undefined;

after(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
});

test("Open-Meteo geocodes Kyiv and PVGIS returns a positive typical year", async () => {
  const location = await describeLocation("Kyiv", 1);
  assert.match(location.summary, /Kyiv/);
  assert.match(location.summary, /Ukraine/);
  const best = (location.details.best ?? {}) as { country_code?: string; latitude?: number };
  assert.equal(best.country_code, "UA");
  assert.ok(typeof best.latitude === "number" && best.latitude > 50 && best.latitude < 51);

  const year = await describeTypicalYear({
    latitude: 50.45466,
    longitude: 30.5238,
    peakPowerKw: 5,
    tiltDegrees: 35,
    azimuthDegrees: 0,
    placeName: "Kyiv",
  });
  const yearly = year.details.yearly_energy_kwh;
  assert.equal(typeof yearly, "number");
  assert.ok(typeof yearly === "number" && yearly > 1000 && yearly < 12000);
  assert.match(year.summary, /PVGIS 5.3/);
});

test("a live MCP call returns a finite Kyiv forecast for a 5 kW array", async () => {
  const app = createApp({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [],
    upstreamTimeoutMs: 20000,
  });
  server = await listen(app, "127.0.0.1", 0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Live server did not bind a port");
  }
  const client = new Client({ name: "sol-solar-live", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "forecast_pv_production",
      arguments: {
        latitude: 50.45466,
        longitude: 30.5238,
        peak_power_kw: 5,
        tilt_degrees: 35,
        azimuth_degrees: 0,
        place_name: "Kyiv",
      },
    });
    assert.notEqual(result.isError, true);
    const text = (result.content as Array<{ text?: string }>).map((item) => item.text ?? "").join("\n");
    assert.match(text, /SUMMARY:/);
    assert.match(text, /Kyiv/);
    const details = JSON.parse(text.slice(text.indexOf("{")));
    assert.equal(details.timezone, "Europe/Kyiv");
    assert.equal(typeof details.today.remaining_kwh, "number");
    assert.ok(details.today.remaining_kwh >= 0);
    assert.equal(typeof details.tomorrow.full_day_kwh, "number");
    assert.ok(details.tomorrow.full_day_kwh >= 0);
    assert.ok(details.today.hours.length + details.tomorrow.hours.length > 0);
  } finally {
    await client.close();
  }
});
