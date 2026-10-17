import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

describe("live public data", () => {
  it("returns a Kyiv 5 kW estimate from Open-Meteo and PVGIS", { timeout: 40_000 }, async () => {
    const port = await freePort();
    const config = loadConfig({
      PORT: String(port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      NODE_ENV: "test",
    });
    const { app, shutdown } = createApp(config);
    const server = app.listen(port, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${port}`;
    try {
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
          resource: config.resourceUrl,
          scope: "solar:read",
          state: "live",
          decision: "allow",
        }),
      });
      const code = new URL(authorized.headers.get("location") ?? "http://invalid").searchParams.get("code");
      assert.ok(code);
      const token = await (await fetch(`${base}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: "sol-solar-web",
          redirect_uri: redirectUri,
          resource: config.resourceUrl,
        }),
      })).json() as { access_token: string };

      const transport = new StreamableHTTPClientTransport(new URL(config.resourceUrl), {
        requestInit: { headers: { authorization: `Bearer ${token.access_token}` } },
      });
      const client = new Client({ name: "sol-solar-live", version: "1.0.0" });
      await client.connect(transport);
      const started = Date.now();
      const site = await client.callTool({
        name: "remember_solar_site",
        arguments: { place: "Kyiv", system_kw: 5, tilt_degrees: 35, azimuth_degrees: 0 },
      });
      const siteBody = (site as { structuredContent: { site_id: string; label: string } }).structuredContent;
      assert.match(siteBody.label, /Kyiv, Ukraine/);
      const answer = await client.callTool({
        name: "best_time_for_appliance",
        arguments: {
          site_id: siteBody.site_id,
          appliance_name: "washing machine",
          power_kw: 0.7,
          duration_hours: 2,
        },
      });
      const elapsed = Date.now() - started;
      const text = ((answer as { content: Array<{ text?: string }> }).content).map((item) => item.text).join(" ");
      const body = (answer as { structuredContent: { days: Array<{ total_kwh: number }>; typical: { database: string; daily_kwh: number } | null; elapsed_ms: number } }).structuredContent;
      assert.match(text, /washing machine/);
      assert.match(text, /kilowatt-hour/);
      assert.doesNotMatch(text, /NaN|undefined/);
      assert.ok(body.days.length >= 1);
      assert.ok(body.days.every((day) => day.total_kwh >= 0));
      assert.ok(body.typical);
      assert.match(body.typical.database, /PVGIS/);
      assert.ok(body.typical.daily_kwh > 0);
      console.log(JSON.stringify({ elapsed_ms: elapsed, tool_ms: body.elapsed_ms, spoken: text, typical: body.typical }, null, 2));
      await client.close();
    } finally {
      await shutdown();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
