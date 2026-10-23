// Writes a fresh random signing key next to the compiled server at build time.
// Every serverless instance of one deployment shares it; a new deployment rotates it.
// dist/ is not served over HTTP and is not committed.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
writeFileSync(new URL("../dist/signing-key.txt", import.meta.url), randomBytes(48).toString("base64url"), { mode: 0o600 });
