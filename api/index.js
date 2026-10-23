import { createApp } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";

// OAuth issuer, redirect URI, and the MCP `resource` must match the public HTTPS origin.
// Use PUBLIC_BASE_URL when set; otherwise Vercel's production domain.
if (!process.env.PUBLIC_BASE_URL) {
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL || "sol-solar-mcp.vercel.app";
  process.env.PUBLIC_BASE_URL = `https://${domain}`;
}

const { app } = createApp(loadConfig());
export default app;
