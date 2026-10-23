import { readFileSync } from "node:fs";
import { createApp } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";

// OAuth issuer, redirect URI, and the MCP `resource` must match the public HTTPS origin.
// Use PUBLIC_BASE_URL when set; otherwise Vercel's production domain.
if (!process.env.PUBLIC_BASE_URL) {
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL || "sol-solar-mcp.vercel.app";
  process.env.PUBLIC_BASE_URL = `https://${domain}`;
}

// Serverless instances share no memory. Stateless mode signs OAuth codes, tokens and
// site ids with one key per deployment, so any instance can verify them.
if (!process.env.MCP_STATELESS) process.env.MCP_STATELESS = "1";
if (!process.env.SIGNING_KEY) {
  try {
    process.env.SIGNING_KEY = readFileSync(new URL("../dist/signing-key.txt", import.meta.url), "utf8").trim();
  } catch {
    // Falls back to a per-instance key (logged by createApp).
  }
}

const { app } = createApp(loadConfig());
export default app;
