import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { ServerConfig } from "./config.js";
import { createSolarServer } from "./mcp.js";

export const SERVER_NAME = "sol-solar";
export const SERVER_VERSION = "1.0.0";

export function createApp(config: ServerConfig): Express {
  const app = createMcpExpressApp(
    config.allowedHosts ? { host: config.host, allowedHosts: config.allowedHosts } : { host: config.host },
  );

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      name: SERVER_NAME,
      version: SERVER_VERSION,
      protocol: LATEST_PROTOCOL_VERSION,
      transport: "streamable-http",
      json_response: true,
      endpoint: "/mcp",
    });
  });

  app.post("/mcp", async (req, res) => {
    if (!originAllowed(req.header("origin"), config.allowedOrigins)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Forbidden origin" },
        id: null,
      });
      return;
    }

    const server = createSolarServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      console.error("MCP request failed", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.use(express.static(publicDir()));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ ok: false });
    }
  });
  return app;
}

export function publicDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
}

export function isAllowedOrigin(origin: string, extraOrigins: string[]): boolean {
  if (extraOrigins.includes(origin)) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function listen(app: Express, host: string, port: number): Promise<Server> {
  const server = createServer(app);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function originAllowed(origin: string | undefined, extraOrigins: string[]): boolean {
  if (!origin) {
    return true;
  }
  return isAllowedOrigin(origin, extraOrigins);
}
