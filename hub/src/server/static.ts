import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../errors.js";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./headers.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const FALLBACK_HTML = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>FFBeast Remote</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b0d10;color:#e6e9ef;padding:48px;line-height:1.5}
code{background:#171b21;border:1px solid #232a33;border-radius:6px;padding:2px 6px}
a{color:#ffb020}
</style></head>
<body>
<h1>FFBeast Remote</h1>
<p>La interfaz todavía no está compilada.</p>
<p>Ejecuta <code>npm run build</code> en la raíz del proyecto y recarga esta página.</p>
<p>El hub está funcionando: <a href="/api/health">/api/health</a>.</p>
</body></html>`;

export interface StaticOptions {
  webRoot: string;
  /** Token que se inyecta como cookie HttpOnly si la petición es local. */
  cookieToken?: string;
  loopback?: boolean;
}

function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  cache: string,
  extraHeaders?: Record<string, string>,
): void {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new HttpError(404, "No encontrado", "not_found");
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Content-Length": String(stat.size),
    "Cache-Control": cache,
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function sendIndex(
  req: IncomingMessage,
  res: ServerResponse,
  webRoot: string,
  options: StaticOptions,
): void {
  const index = path.join(webRoot, "index.html");
  const headers: Record<string, string> = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  };
  if (options.loopback && options.cookieToken) {
    headers["Set-Cookie"] =
      `ffbeast_token=${encodeURIComponent(options.cookieToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;
  }
  if (fs.existsSync(index)) {
    sendFile(req, res, index, "no-store", headers);
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(FALLBACK_HTML);
}

/** Sirve la PWA compilada con fallback SPA. Devuelve true si ha respondido. */
export function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: StaticOptions,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw new HttpError(405, "Método no permitido", "method_not_allowed");
  }

  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "Ruta inválida", "invalid_path");
  }

  if (decoded === "/" || decoded === "/m" || decoded === "/m/") {
    sendIndex(req, res, options.webRoot, options);
    return true;
  }

  if (!options.webRoot || !fs.existsSync(options.webRoot)) {
    sendIndex(req, res, options.webRoot, options);
    return true;
  }

  const root = path.resolve(options.webRoot);
  const safe = path.normalize(decoded).replace(/^([/\\])+/, "");
  const filePath = path.resolve(root, safe);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    throw new HttpError(404, "No encontrado", "not_found");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const hashed = /\/assets\/.+-[A-Za-z0-9_-]{6,}\./.test(decoded);
    sendFile(req, res, filePath, hashed ? "public, max-age=31536000, immutable" : "no-cache");
    return true;
  }

  // Ruta del SPA (sin extension) -> index.html
  if (!path.extname(decoded)) {
    sendIndex(req, res, options.webRoot, options);
    return true;
  }

  throw new HttpError(404, "No encontrado", "not_found");
}
