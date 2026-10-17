import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, shutdown } = createApp(config);
const server = app.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    msg: "listening",
    mcp: `${config.publicBaseUrl}/mcp`,
    demo: `${config.publicBaseUrl}/`,
    protocol: "2025-11-25",
    transport: "streamable-http",
    devBearer: Boolean(config.devBearerToken),
    store: config.store,
  }));
});

async function stop(): Promise<void> {
  await shutdown();
  server.close();
}

process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
