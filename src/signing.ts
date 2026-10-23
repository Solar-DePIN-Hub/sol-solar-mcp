import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signed, self-contained values: `<prefix>.<base64url(json)>.<base64url(mac)>`.
 * Used in stateless mode, where any serverless instance must accept a code, a token,
 * or a household id that a different instance issued.
 */
export class Signer {
  private readonly key: Buffer;

  constructor(key: string) {
    if (key.length < 32) throw new Error("SIGNING_KEY must be at least 32 characters");
    this.key = Buffer.from(key);
  }

  static random(): Signer {
    return new Signer(randomBytes(32).toString("base64url"));
  }

  private mac(prefix: string, body: string): string {
    return createHmac("sha256", this.key).update(`${prefix}.${body}`).digest("base64url").slice(0, 32);
  }

  sign(prefix: string, value: unknown): string {
    const body = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${prefix}.${body}.${this.mac(prefix, body)}`;
  }

  verify<T>(prefix: string, signed: string): T | undefined {
    const parts = signed.split(".");
    if (parts.length !== 3 || parts[0] !== prefix) return undefined;
    const [, body, mac] = parts as [string, string, string];
    const expected = Buffer.from(this.mac(prefix, body));
    const actual = Buffer.from(mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    } catch {
      return undefined;
    }
  }
}
