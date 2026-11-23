import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import QRCode from "qrcode";
import { FIELDS } from "../hid/fields.js";
import type { AppConfig, DeviceSettings } from "../hid/types.js";
import type { WheelDevice } from "../hid/driver.js";
import type { JoystickLike } from "../hid/joystick.js";
import type { CommandName } from "../hid/codec.js";
import type { Logger } from "../log.js";
import { HttpError } from "../errors.js";
import { VERSION, appDataDir, configPath, newToken, saveConfig } from "../config.js";
import type { Auth } from "./auth.js";
import { RateLimiter } from "./auth.js";
import type { ProfileStore } from "../domain/profiles.js";
import { lanAddresses, mobileUrl, primaryLanAddress } from "./net.js";
import { serveStatic } from "./static.js";
import { WsHub } from "./ws.js";

const MAX_BODY_BYTES = 64 * 1024;
const COMMANDS: CommandName[] = ["reboot", "save", "dfu", "reset-center"];

export interface ServerDeps {
  config: AppConfig;
  auth: Auth;
  device: WheelDevice;
  joystick: JoystickLike;
  profiles: ProfileStore;
  log: Logger;
  webRoot: string;
  startedAt: number;
}

export interface HubServer {
  readonly server: http.Server;
  readonly ws: WsHub;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
  broadcast(type: string, data: unknown): void;
}

export function createHubServer(deps: ServerDeps): HubServer {
  const limiter = new RateLimiter(20, 40);
  const ws = new WsHub({
    auth: deps.auth,
    device: deps.device,
    joystick: deps.joystick,
    log: deps.log.child("ws"),
    config: deps.config,
  });

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      sendError(res, error, deps.log);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/ws" && url.pathname !== "/api/v1/ws") {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(req, socket, head);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const loopback = deps.auth.isLoopback(req);
    const path = url.pathname;

    if (isApiPath(path)) {
      const apiPath = normalizeApiPath(path);

      if (apiPath === "/api/health") {
        // En localhost sembramos la cookie para que la UI del PC (y el proxy de
        // Vite en desarrollo) quede autenticada sin pedir el token.
        if (loopback) setTokenCookie(res, deps.auth.current);
        sendJson(res, 200, { ok: true, version: VERSION, api: 1 });
        return;
      }

      const ip = req.socket.remoteAddress ?? "unknown";
      if (!limiter.allow(ip)) {
        res.setHeader("Retry-After", "1");
        throw new HttpError(429, "Demasiadas peticiones", "rate_limited");
      }
      if (!deps.auth.isAuthenticated(req, url)) {
        throw new HttpError(401, "Token inválido o ausente", "unauthorized");
      }
      await handleApi(req, res, url, apiPath, loopback);
      return;
    }

    serveStatic(req, res, path, {
      webRoot: deps.webRoot,
      cookieToken: deps.auth.current,
      loopback,
    });
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    path: string,
    loopback: boolean,
  ): Promise<void> {
    const method = req.method ?? "GET";
    const { device, profiles, config, auth } = deps;

    // ------------------------------------------------------------- estado
    if (method === "GET" && path === "/api/status") {
      sendJson(res, 200, { status: device.status() });
      return;
    }

    if (method === "GET" && path === "/api/state") {
      const live = device.getLive();
      sendJson(res, 200, {
        state: live ? { ...live, axes: deps.joystick.getAxes() } : null,
      });
      return;
    }

    if (method === "GET" && path === "/api/session") {
      sendJson(res, 200, { authenticated: true, loopback, readOnly: config.readOnly });
      return;
    }

    if (method === "GET" && path === "/api/fields") {
      sendJson(res, 200, { fields: FIELDS });
      return;
    }

    // ----------------------------------------------------------- ajustes
    if (method === "GET" && path === "/api/settings") {
      if (device.connected) {
        try {
          await device.refreshAll();
        } catch {
          // Si el volante se acaba de desconectar, devolvemos la ultima copia.
        }
      }
      sendJson(res, 200, {
        settings: device.getSettings(),
        fields: FIELDS,
        connected: device.connected,
      });
      return;
    }

    if (method === "POST" && path === "/api/settings") {
      const body = await readJson(req);
      if (!isRecord(body)) throw new HttpError(400, "Cuerpo inválido", "invalid_body");
      const field = body.field;
      if (typeof field !== "string" && typeof field !== "number") {
        throw new HttpError(422, "Falta el campo 'field'", "invalid_field");
      }
      const value = Number(body.value);
      const index = body.index === undefined ? 0 : Number(body.index);
      const settings = await device.writeSetting(field, value, index);
      sendJson(res, 200, { ok: true, settings });
      return;
    }

    if (method === "POST" && path === "/api/settings/apply") {
      const body = await readJson(req);
      if (!isRecord(body)) throw new HttpError(400, "Cuerpo inválido", "invalid_body");
      const payload = isRecord(body.settings) ? body.settings : body;
      const result = await device.applyAll(payload as Partial<DeviceSettings>);
      sendJson(res, 200, {
        ok: true,
        settings: result.settings,
        restartRequired: result.restartRequired,
      });
      return;
    }

    // ----------------------------------------------------------- comandos
    if (method === "POST" && path === "/api/command") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.name !== "string") {
        throw new HttpError(422, "Falta el nombre del comando", "invalid_command");
      }
      if (!COMMANDS.includes(body.name as CommandName)) {
        throw new HttpError(422, `Comando desconocido: ${body.name}`, "invalid_command");
      }
      await device.command(body.name as CommandName);
      sendJson(res, 202, { ok: true, name: body.name });
      return;
    }

    // ------------------------------------------------------------ perfiles
    if (method === "GET" && path === "/api/profiles") {
      sendJson(res, 200, { profiles: profiles.list() });
      return;
    }

    if (method === "GET" && path === "/api/profiles/export") {
      sendJson(res, 200, profiles.exportAll());
      return;
    }

    if (method === "POST" && path === "/api/profiles/import") {
      const body = await readJson(req);
      const imported = profiles.importAll(body);
      sendJson(res, 200, { ok: true, imported });
      return;
    }

    if (method === "POST" && path === "/api/profiles") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.name !== "string") {
        throw new HttpError(422, "Falta el nombre del perfil", "invalid_name");
      }
      const settings = isRecord(body.settings)
        ? (body.settings as unknown as DeviceSettings)
        : device.getSettings();
      if (!settings) throw new HttpError(409, "Volante desconectado", "wheel_disconnected");
      const profile = profiles.create(body.name, settings);
      sendJson(res, 201, { ok: true, profile });
      return;
    }

    if (method === "POST" && path === "/api/profiles/apply") {
      const body = await readJson(req);
      if (!isRecord(body) || typeof body.id !== "string") {
        throw new HttpError(422, "Falta el id del perfil", "invalid_profile");
      }
      const profile = profiles.get(body.id);
      if (!profile) throw new HttpError(404, "Perfil no encontrado", "profile_not_found");
      const result = await device.applyAll(profile.deviceSettings);
      sendJson(res, 200, {
        ok: true,
        settings: result.settings,
        restartRequired: result.restartRequired,
      });
      return;
    }

    const profileMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
    if (method === "DELETE" && profileMatch) {
      const id = decodeURIComponent(profileMatch[1] ?? "");
      if (!profiles.delete(id)) {
        throw new HttpError(404, "Perfil no encontrado", "profile_not_found");
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // ------------------------------------------------------------ config
    if (method === "GET" && path === "/api/config") {
      sendJson(res, 200, {
        config: {
          port: config.port,
          readOnly: config.readOnly,
          allowSaveCommand: config.allowSaveCommand,
          allowRebootCommand: config.allowRebootCommand,
          allowDfuCommand: config.allowDfuCommand,
          stateHz: config.stateHz,
          mock: config.mock,
        },
      });
      return;
    }

    if (method === "POST" && path === "/api/config") {
      const body = await readJson(req);
      if (!isRecord(body)) throw new HttpError(400, "Cuerpo inválido", "invalid_body");
      if (typeof body.readOnly === "boolean") config.readOnly = body.readOnly;
      if (loopback && typeof body.allowSaveCommand === "boolean") {
        config.allowSaveCommand = body.allowSaveCommand;
      }
      saveConfig(config);
      ws.broadcast("status", device.status());
      sendJson(res, 200, { ok: true, config });
      return;
    }

    // ------------------------------------------------------------ token/QR
    if (method === "GET" && path === "/api/token") {
      if (!loopback) throw new HttpError(403, "Solo desde el PC", "loopback_only");
      sendJson(res, 200, { token: auth.current });
      return;
    }

    if (method === "POST" && path === "/api/token/regenerate") {
      if (!loopback) throw new HttpError(403, "Solo desde el PC", "loopback_only");
      auth.setToken(newToken());
      config.token = auth.current;
      saveConfig(config);
      setTokenCookie(res, auth.current);
      sendJson(res, 200, { token: auth.current });
      return;
    }

    if (method === "GET" && path === "/api/qr") {
      if (!loopback) throw new HttpError(403, "Solo desde el PC", "loopback_only");
      const host = url.searchParams.get("host") ?? primaryLanAddress();
      const target = mobileUrl(config.port, auth.current, host);
      const png = await QRCode.toBuffer(target, {
        type: "png",
        width: 360,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(png.length),
        "Cache-Control": "no-store",
      });
      res.end(png);
      return;
    }

    if (method === "GET" && path === "/api/qr/url") {
      if (!loopback) throw new HttpError(403, "Solo desde el PC", "loopback_only");
      const host = url.searchParams.get("host") ?? primaryLanAddress();
      sendJson(res, 200, {
        url: mobileUrl(config.port, auth.current, host),
        host,
        addresses: lanAddresses(),
      });
      return;
    }

    // --------------------------------------------------------- diagnostico
    if (method === "GET" && path === "/api/logs") {
      if (!loopback) throw new HttpError(403, "Solo desde el PC", "loopback_only");
      const lines = Number(url.searchParams.get("lines") ?? 200);
      sendJson(res, 200, { lines: deps.log.recentLines(Math.min(Math.max(lines, 1), 1000)) });
      return;
    }

    if (method === "GET" && path === "/api/diagnostics") {
      sendJson(res, 200, {
        version: VERSION,
        api: 1,
        uptimeSeconds: Math.round((Date.now() - deps.startedAt) / 1000),
        port: config.port,
        readOnly: config.readOnly,
        mock: config.mock,
        connected: device.connected,
        firmware: device.status().firmware,
        license: device.getLicense(),
        joystickConnected: Boolean(deps.joystick.getAxes()),
        lan: lanAddresses(),
        dataDir: appDataDir(),
        configPath: configPath(),
        hid: safeList(device),
      });
      return;
    }

    throw new HttpError(404, "Ruta no encontrada", "not_found");
  }

  function listen(port = deps.config.port, host = "0.0.0.0"): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("error", onError);
        reject(error);
      };
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        const address = server.address() as AddressInfo | null;
        resolve(address?.port ?? port);
      });
    });
  }

  async function close(): Promise<void> {
    ws.close();
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }

  return {
    server,
    ws,
    listen,
    close,
    broadcast: (type, data) => ws.broadcast(type, data),
  };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/") || path.startsWith("/api/v1");
}

function normalizeApiPath(path: string): string {
  if (path === "/api/v1") return "/api";
  if (path.startsWith("/api/v1/")) return `/api/${path.slice("/api/v1/".length)}`;
  return path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function setTokenCookie(res: ServerResponse, token: string): void {
  res.setHeader(
    "Set-Cookie",
    `ffbeast_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
  );
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(body)),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendError(res: ServerResponse, error: unknown, log: Logger): void {
  if (res.headersSent || res.writableEnded) {
    res.destroy();
    return;
  }
  if (error instanceof HttpError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  log.error("Error no controlado", error);
  sendJson(res, 500, {
    error: { code: "internal", message: "Error interno del hub" },
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Cuerpo demasiado grande (máx. 64 KB)", "payload_too_large");
    }
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "JSON inválido", "invalid_json");
  }
}

function safeList(device: WheelDevice): unknown {
  try {
    return device.factory.list();
  } catch {
    return [];
  }
}
