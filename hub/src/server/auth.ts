import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

export function sha256(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

/** Comparacion en tiempo constante usando hashes de longitud fija. */
export function safeEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export class Auth {
  constructor(private token: string) {}

  get current(): string {
    return this.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  tokenFromRequest(req: IncomingMessage, url: URL): string | null {
    const header = req.headers.authorization;
    if (header && header.startsWith("Bearer ")) {
      const value = header.slice("Bearer ".length).trim();
      if (value) return value;
    }
    const query = url.searchParams.get("t");
    if (query) return query;
    const cookie = parseCookies(req.headers.cookie).ffbeast_token;
    if (cookie) return cookie;
    return null;
  }

  isAuthenticated(req: IncomingMessage, url: URL): boolean {
    return safeEqual(this.tokenFromRequest(req, url), this.token);
  }

  isLoopback(req: IncomingMessage): boolean {
    const address = req.socket.remoteAddress ?? "";
    // Todo 127.0.0.0/8 es loopback, no solo 127.0.0.1.
    return (
      address === "::1" ||
      address.startsWith("127.") ||
      address.startsWith("::ffff:127.")
    );
  }
}

/** Token bucket sencillo por IP. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number }>();
  private lastCleanup = Date.now();

  constructor(
    private readonly ratePerSecond = 20,
    private readonly burst = 40,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    if (now - this.lastCleanup > 300_000) this.cleanup(now);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.burst, last: now };
      this.buckets.set(key, bucket);
    }
    const elapsed = (now - bucket.last) / 1000;
    bucket.tokens = Math.min(this.burst, bucket.tokens + elapsed * this.ratePerSecond);
    bucket.last = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  private cleanup(now: number): void {
    this.lastCleanup = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.last > 600_000) this.buckets.delete(key);
    }
  }
}
