import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Config } from "./config.js";
import type { KeyValueStore } from "./store.js";

interface AuthCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource: string;
  scope: string;
  expiresAt: number;
}

interface AccessToken {
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: number;
}

const SCOPE = "solar:read";

export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char] ?? char;
  });
}

function oauthError(res: Response, status: number, error: string, description: string): void {
  res.status(status).set("cache-control", "no-store").json({ error, error_description: description });
}

function formValue(req: Request, name: string): string {
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body?.[name];
  if (typeof fromBody === "string") return fromBody;
  const fromQuery = req.query[name];
  return typeof fromQuery === "string" ? fromQuery : "";
}

export function protectedResourceMetadata(config: Config) {
  return {
    resource: config.resourceUrl,
    authorization_servers: [config.issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Sol Solar",
  };
}

export function authorizationServerMetadata(config: Config) {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}

function consentPage(fields: Record<string, string>): string {
  const hidden = Object.entries(fields)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Allow Sol Solar</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="consent">
    <p class="eyebrow">Sol Solar</p>
    <h1>Allow this browser to ask about the roof?</h1>
    <p>The demo client will call the solar tools for this session. It sees the place, array size, and optional price you type. It does not ask for an account, and it does not read an inverter.</p>
    <form method="post" action="/authorize">
      ${hidden}
      <button type="submit" name="decision" value="allow">Allow</button>
      <button type="submit" class="secondary" name="decision" value="deny">Deny</button>
    </form>
  </main>
</body>
</html>`;
}

function validateAuthorize(config: Config, fields: Record<string, string>): string | null {
  if (!config.clientIds.includes(fields.client_id ?? "")) return "Unknown client_id.";
  if (!config.redirectUris.includes(fields.redirect_uri ?? "")) return "redirect_uri is not registered for this client.";
  if (fields.response_type !== "code") return "response_type must be code.";
  if (fields.code_challenge_method !== "S256") return "code_challenge_method must be S256.";
  if (!fields.code_challenge || fields.code_challenge.length < 43) return "A PKCE S256 code_challenge is required.";
  if (fields.resource !== config.resourceUrl) return "resource must be this server's MCP URL.";
  if (fields.scope && fields.scope !== SCOPE) return `scope must be ${SCOPE}.`;
  if (!fields.state) return "state is required.";
  return null;
}

export function registerAuth(app: Express, config: Config, store: KeyValueStore): void {
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json(protectedResourceMetadata(config));
  });
  app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
    res.json(protectedResourceMetadata(config));
  });
  app.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json(authorizationServerMetadata(config));
  });

  app.get("/authorize", (req, res) => {
    const fields = {
      response_type: formValue(req, "response_type"),
      client_id: formValue(req, "client_id"),
      redirect_uri: formValue(req, "redirect_uri"),
      code_challenge: formValue(req, "code_challenge"),
      code_challenge_method: formValue(req, "code_challenge_method"),
      resource: formValue(req, "resource"),
      scope: formValue(req, "scope") || SCOPE,
      state: formValue(req, "state"),
    };
    const problem = validateAuthorize(config, fields);
    if (problem) {
      res.status(400).type("html").send(`<!DOCTYPE html><html lang="en"><body><p>${escapeHtml(problem)}</p></body></html>`);
      return;
    }
    res.type("html").send(consentPage(fields));
  });

  app.post("/authorize", async (req, res) => {
    const fields = {
      response_type: formValue(req, "response_type"),
      client_id: formValue(req, "client_id"),
      redirect_uri: formValue(req, "redirect_uri"),
      code_challenge: formValue(req, "code_challenge"),
      code_challenge_method: formValue(req, "code_challenge_method"),
      resource: formValue(req, "resource"),
      scope: formValue(req, "scope") || SCOPE,
      state: formValue(req, "state"),
    };
    const problem = validateAuthorize(config, fields);
    if (problem) {
      oauthError(res, 400, "invalid_request", problem);
      return;
    }
    const decision = formValue(req, "decision");
    const redirect = new URL(fields.redirect_uri);
    redirect.searchParams.set("state", fields.state);
    if (decision !== "allow") {
      redirect.searchParams.set("error", "access_denied");
      res.redirect(302, redirect.toString());
      return;
    }
    const code = randomBytes(32).toString("base64url");
    const record: AuthCode = {
      clientId: fields.client_id,
      redirectUri: fields.redirect_uri,
      challenge: fields.code_challenge,
      resource: fields.resource,
      scope: fields.scope,
      expiresAt: Date.now() + 60_000,
    };
    await store.set(`code:${code}`, JSON.stringify(record), 60);
    redirect.searchParams.set("code", code);
    res.redirect(302, redirect.toString());
  });

  app.post("/token", async (req, res) => {
    const grant = formValue(req, "grant_type");
    if (grant !== "authorization_code") {
      oauthError(res, 400, "unsupported_grant_type", "Only authorization_code is supported.");
      return;
    }
    const code = formValue(req, "code");
    const verifier = formValue(req, "code_verifier");
    const clientId = formValue(req, "client_id");
    const redirectUri = formValue(req, "redirect_uri");
    const resource = formValue(req, "resource");
    if (!code || !verifier || !clientId || !redirectUri || !resource) {
      oauthError(res, 400, "invalid_request", "code, code_verifier, client_id, redirect_uri, and resource are required.");
      return;
    }
    const raw = await store.take(`code:${code}`);
    if (!raw) {
      oauthError(res, 400, "invalid_grant", "The authorization code is unknown, expired, or already used.");
      return;
    }
    const saved = JSON.parse(raw) as AuthCode;
    if (saved.expiresAt <= Date.now() || saved.clientId !== clientId || saved.redirectUri !== redirectUri || saved.resource !== resource) {
      oauthError(res, 400, "invalid_grant", "The authorization code does not match this client, redirect, or resource.");
      return;
    }
    if (!safeEqual(s256Challenge(verifier), saved.challenge)) {
      oauthError(res, 400, "invalid_grant", "PKCE verification failed.");
      return;
    }
    const token = randomBytes(32).toString("base64url");
    const access: AccessToken = {
      clientId,
      resource,
      scope: saved.scope,
      expiresAt: Date.now() + config.tokenTtlSeconds * 1000,
    };
    await store.set(`token:${token}`, JSON.stringify(access), config.tokenTtlSeconds);
    res.set("cache-control", "no-store").json({
      access_token: token,
      token_type: "Bearer",
      expires_in: config.tokenTtlSeconds,
      scope: saved.scope,
    });
  });
}

export async function readBearer(config: Config, store: KeyValueStore, req: Request, res: Response): Promise<boolean> {
  if (typeof req.query.access_token === "string" || typeof req.query.token === "string") {
    oauthError(res, 400, "invalid_request", "Send the access token in the Authorization header, not the query string.");
    return false;
  }
  const header = req.header("authorization");
  if (!header || !/^Bearer\s+\S+/.test(header)) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  const token = header.replace(/^Bearer\s+/, "").trim();
  if (config.devBearerToken && safeEqual(token, config.devBearerToken)) return true;
  const raw = await store.get(`token:${token}`);
  if (!raw) {
    res.status(401).json({ error: "invalid_token" });
    return false;
  }
  const saved = JSON.parse(raw) as AccessToken;
  if (saved.expiresAt <= Date.now() || saved.resource !== config.resourceUrl) {
    res.status(401).json({ error: "invalid_token" });
    return false;
  }
  return true;
}
