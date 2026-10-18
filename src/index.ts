import { loadConfig } from "./config.js";
import { createApp, listen, SERVER_NAME, SERVER_VERSION } from "./http.js";

const config = loadConfig();
const app = createApp(config);
const server = await listen(app, config.host, config.port);
const address = server.address();
const shownHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
const port = address && typeof address === "object" ? address.port : config.port;

console.log(`${SERVER_NAME} ${SERVER_VERSION} listening on http://${shownHost}:${port}`);
console.log(`MCP endpoint http://${shownHost}:${port}/mcp`);
console.log(`Simulator http://${shownHost}:${port}/`);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
