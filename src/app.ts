import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { readBearer, registerAuth } from "./auth.js";
import type { Config } from "./config.js";
import { createStore } from "./dynamoStore.js";
import { SiteBook } from "./sites.js";
import type { Deps } from "./service.js";
import type { KeyValueStore } from "./store.js";
import { registerSolarTools } from "./tools.js";
import { SOLAR_CARD_HTML } from "./ui/solarCard.js";
import { Signer } from "./signing.js";

const MAX_SESSIONS = 200;

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActive: number;
}

export interface AppOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  store?: KeyValueStore;
}

function originAllowed(config: Config, origin: string | undefined): boolean {
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  if (config.nodeEnv !== "production") return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return false;
}

function buildServer(deps: Deps): McpServer {
  const server = new McpServer({
    name: "sol-solar",
    version: "1.1.0",
  }, {
    instructions: "Sol Solar estimates photovoltaic production for one home or small array. It says when to run appliances, whether a typed battery lasts the night, and gives a morning solar briefing. Speak the tool text to the person. Never invent kilowatt-hours, a clock time, a battery size, or a household load. Figures are model estimates, not inverter measurements. Keep the site_id between turns and between sessions: it also holds the appliances the person saved, so later they can just say 'the washer'. Tools that draw a day chart point to the MCP App ui://sol-solar/solar-card.html.",
  });
  registerSolarTools(server, deps);
  return server;
}

export function createApp(config: Config, options: AppOptions = {}): { app: Express; shutdown: () => Promise<void> } {
  const store = options.store ?? createStore(config);
  const signer = config.stateless ? (config.signingKey ? new Signer(config.signingKey) : Signer.random()) : undefined;
  if (config.stateless && !config.signingKey) {
    console.log(JSON.stringify({ level: "warn", message: "MCP_STATELESS without SIGNING_KEY: using a per-process key" }));
  }
  const deps: Deps = {
    config,
    store,
    sites: new SiteBook(store, signer),
    fetch: options.fetch ?? fetch,
    now: options.now ?? (() => new Date()),
  };
  const sessions = new Map<string, Session>();
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (origin && originAllowed(config, origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      if (req.path === "/health") return;
      console.log(JSON.stringify({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }));
    });
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: "sol-solar", protocol: "2025-11-25", transport: "streamable-http" });
  });
  app.get("/client-config", (_req, res) => {
    res.json({
      clientId: "sol-solar-web",
      scope: "solar:read",
      resource: config.resourceUrl,
      protocolVersion: "2025-11-25",
    });
  });
  // HTTP mirror of the ui://sol-solar/solar-card.html MCP App resource, byte for byte.
  // The voice client loads it into a sandboxed iframe, because its own CSP blocks inline script in srcdoc.
  app.get("/ui/solar-card.html", (_req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'");
    res.type("html").send(SOLAR_CARD_HTML);
  });
  registerAuth(app, config, store, signer);

  app.all("/mcp", async (req, res) => {
    const origin = req.header("origin");
    if (!originAllowed(config, origin)) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Forbidden origin" }, id: null });
      return;
    }
    if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }
    if (!(await readBearer(config, store, req, res, signer))) return;

    if (config.stateless) {
      // Serverless: a fresh server and transport per request, no Mcp-Session-Id.
      if (req.method !== "POST") {
        res.status(405).set("allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Stateless server: use POST." }, id: null });
        return;
      }
      try {
        const server = buildServer(deps);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.log(JSON.stringify({ level: "error", path: "/mcp", message: error instanceof Error ? error.message : "unknown" }));
        if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
      return;
    }

    const sessionId = req.header("mcp-session-id");
    try {
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
          return;
        }
        session.lastActive = Date.now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }
      if (req.method === "POST" && isInitializeRequest(req.body)) {
        if (sessions.size >= MAX_SESSIONS) {
          res.status(503).json({ jsonrpc: "2.0", error: { code: -32000, message: "Too many sessions" }, id: null });
          return;
        }
        const server = buildServer(deps);
        let transport: StreamableHTTPServerTransport;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, server, lastActive: Date.now() });
          },
        });
        transport.onclose = () => {
          const id = transport.sessionId;
          if (!id) return;
          sessions.delete(id);
          deps.sites.forgetSession(id);
        };
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Send initialize, or include a valid Mcp-Session-Id header." },
        id: null,
      });
    } catch (error) {
      console.log(JSON.stringify({ level: "error", path: "/mcp", message: error instanceof Error ? error.message : "unknown" }));
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  app.get("/favicon.ico", (_req, res) => res.redirect(301, "/favicon.svg"));
  app.use(express.static(path.join(process.cwd(), "web")));

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;
    if (status === 400) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    console.log(JSON.stringify({ level: "error", message: error instanceof Error ? error.message : "unknown" }));
    res.status(500).json({ error: "internal_error" });
  });

  const timer = setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, session] of sessions) {
      if (session.lastActive >= cutoff) continue;
      sessions.delete(id);
      deps.sites.forgetSession(id);
      void session.transport.close();
      void session.server.close();
    }
  }, 60_000);
  timer.unref();

  return {
    app,
    async shutdown() {
      clearInterval(timer);
      await Promise.all([...sessions.values()].map(async (session) => {
        await session.transport.close().catch(() => undefined);
        await session.server.close().catch(() => undefined);
      }));
      sessions.clear();
    },
  };
}
