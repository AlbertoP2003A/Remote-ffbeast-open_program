import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/hid/types.js";
import { createLogger } from "../src/log.js";
import { MockFactory } from "../src/hid/mock.js";
import { MockJoystick } from "../src/hid/joystick.js";
import { WheelDevice } from "../src/hid/driver.js";
import { ProfileStore } from "../src/domain/profiles.js";
import { ConflictMonitor } from "../src/domain/conflict.js";
import { Auth } from "../src/server/auth.js";
import {
  canDisableReadOnly,
  createHubServer,
  type HubServer,
} from "../src/server/http.js";

const TOKEN = "test-token-0123456789";

let dir: string;
let config: AppConfig;
let device: WheelDevice;
let joystick: MockJoystick;
let conflict: ConflictMonitor;
let hub: HubServer;
let base: string;

async function waitFor(predicate: () => boolean, timeout = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error("timeout esperando condición");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
}

async function api(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${pathname}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffbeast-remote-test-"));
  // Aisla config.ts: POST /api/config llama a saveConfig y, sin esto, escribiria
  // en %APPDATA%\ffbeast-remote (la configuracion real del usuario).
  process.env.FFBEAST_DATA_DIR = dir;
  config = {
    version: 1,
    port: 0,
    token: TOKEN,
    readOnly: false,
    allowSaveCommand: true,
    allowRebootCommand: false,
    allowDfuCommand: false,
    stateHz: 20,
    logLevel: "error",
    mock: true,
  };
  const log = createLogger({ dir, level: "error" });
  const factory = new MockFactory();
  device = new WheelDevice({ factory, config, log, reconnectMs: 100 });
  device.start();
  joystick = new MockJoystick();
  joystick.start();
  await waitFor(() => device.connected && device.getSettings() !== null);

  const profiles = new ProfileStore(dir, log);
  conflict = new ConflictMonitor({ processes: [], log });
  const auth = new Auth(TOKEN);
  hub = createHubServer({
    config,
    auth,
    device,
    joystick,
    profiles,
    conflict,
    log,
    webRoot: path.resolve(process.cwd(), "..", "web", "dist"),
    startedAt: Date.now(),
  });
  const port = await hub.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await device.stop();
  joystick.stop();
  conflict.stop();
  await hub.close();
  delete process.env.FFBEAST_DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("API HTTP", () => {
  it("health no requiere token", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBe("1.0.0");
  });

  it("status exige token", async () => {
    const res = await fetch(`${base}/api/status`);
    expect(res.status).toBe(401);
  });

  it("añade cabeceras de seguridad a la UI y a la API", async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");

    const health = await fetch(`${base}/api/health`);
    expect(health.headers.get("x-frame-options")).toBe("DENY");
    expect(health.headers.get("permissions-policy")).toContain("geolocation=()");
  });

  it("status devuelve el volante simulado", async () => {
    const res = await api("/api/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: {
        connected: boolean;
        mock: boolean;
        firmware: string;
        license: { isRegistered: boolean };
        health: { degraded: boolean };
        conflict: { active: boolean };
      };
    };
    expect(body.status.connected).toBe(true);
    expect(body.status.mock).toBe(true);
    expect(body.status.firmware).toBe("26.1.1");
    expect(body.status.license.isRegistered).toBe(true);
    expect(body.status.health.degraded).toBe(false);
    expect(body.status.conflict.active).toBe(false);
  });

  it("GET /api/settings devuelve ajustes y metadatos", async () => {
    const res = await api("/api/settings");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settings: { effects: { motionRange: number } };
      fields: Array<{ name: string }>;
      connected: boolean;
    };
    expect(body.connected).toBe(true);
    expect(body.settings.effects.motionRange).toBe(900);
    expect(body.fields.some((field) => field.name === "motionRange")).toBe(true);
  });

  it("escribe un ajuste y lo lee de vuelta", async () => {
    const res = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ field: "motionRange", value: 950 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: { effects: { motionRange: number } } };
    expect(body.settings.effects.motionRange).toBe(950);

    const check = await api("/api/settings");
    const checkBody = (await check.json()) as { settings: { effects: { motionRange: number } } };
    expect(checkBody.settings.effects.motionRange).toBe(950);
  });

  it("acepta también el ID numérico del campo (formato del plan)", async () => {
    const res = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ field: 17, value: 70 }),
    });
    expect(res.status).toBe(200);
  });

  it("rechaza campo desconocido", async () => {
    const res = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ field: "noExiste", value: 1 }),
    });
    expect(res.status).toBe(422);
  });

  it("rechaza valor fuera de rango", async () => {
    const res = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ field: "motionRange", value: 5000 }),
    });
    expect(res.status).toBe(422);
  });

  it("detecta read-back fallido", async () => {
    const stubbornConfig: AppConfig = { ...config, port: 0 };
    const stubborn = new WheelDevice({
      factory: new MockFactory({ ignoreFields: new Set(["motionRange"]) }),
      config: stubbornConfig,
      log: createLogger({ dir, level: "error" }),
      reconnectMs: 50,
    });
    stubborn.start();
    await waitFor(() => stubborn.connected && stubborn.getSettings() !== null);
    await expect(stubborn.writeSetting("motionRange", 950)).rejects.toMatchObject({
      status: 409,
      code: "readback_failed",
    });
    await stubborn.stop();
  });

  it("marca el volante como inestable tras tres fallos y bloquea escrituras", async () => {
    const stubborn = new WheelDevice({
      factory: new MockFactory({ ignoreFields: new Set(["motionRange"]) }),
      config: { ...config, port: 0 },
      log: createLogger({ dir, level: "error" }),
      reconnectMs: 50,
    });
    stubborn.start();
    await waitFor(() => stubborn.connected && stubborn.getSettings() !== null);

    for (let i = 0; i < 3; i += 1) {
      await expect(stubborn.writeSetting("motionRange", 950 + i)).rejects.toMatchObject({
        status: 409,
      });
    }
    expect(stubborn.status().health.degraded).toBe(true);
    expect(stubborn.status().health.consecutiveFailures).toBeGreaterThanOrEqual(3);

    await expect(stubborn.writeSetting("motionRange", 900)).rejects.toMatchObject({
      status: 409,
      code: "wheel_unstable",
    });

    await stubborn.refreshAll();
    expect(stubborn.status().health.degraded).toBe(false);
    await stubborn.stop();
  });

  it("aplica un bloque completo", async () => {
    const res = await api("/api/settings/apply", {
      method: "POST",
      body: JSON.stringify({
        settings: {
          effects: { totalEffectStrength: 80, softStopStrength: 90 },
          hardware: { powerLimit: 60 },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settings: { effects: { totalEffectStrength: number }; hardware: { powerLimit: number } };
    };
    expect(body.settings.effects.totalEffectStrength).toBe(80);
    expect(body.settings.hardware.powerLimit).toBe(60);
  });

  it("GET /api/state incluye los ejes del joystick", async () => {
    const res = await api("/api/state");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: { axes: { x: number; ry: number; rz: number; slider: number } | null } | null;
    };
    expect(body.state).not.toBeNull();
    expect(body.state?.axes).not.toBeNull();
    expect(typeof body.state?.axes?.ry).toBe("number");
  });

  it("crea, lista, aplica y borra perfiles", async () => {
    const created = await api("/api/profiles", {
      method: "POST",
      body: JSON.stringify({ name: "Test GT3" }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { profile: { id: string; name: string } };
    expect(createdBody.profile.name).toBe("Test GT3");

    const list = await api("/api/profiles");
    const listBody = (await list.json()) as { profiles: Array<{ id: string }> };
    expect(listBody.profiles.some((profile) => profile.id === createdBody.profile.id)).toBe(true);

    const applied = await api("/api/profiles/apply", {
      method: "POST",
      body: JSON.stringify({ id: createdBody.profile.id }),
    });
    expect(applied.status).toBe(200);

    const removed = await api(`/api/profiles/${createdBody.profile.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);

    const missing = await api("/api/profiles/apply", {
      method: "POST",
      body: JSON.stringify({ id: createdBody.profile.id }),
    });
    expect(missing.status).toBe(404);
  });

  it("modo solo lectura bloquea escrituras", async () => {
    const on = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ readOnly: true }),
    });
    expect(on.status).toBe(200);

    const blocked = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ field: "motionRange", value: 900 }),
    });
    expect(blocked.status).toBe(403);

    const off = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ readOnly: false }),
    });
    expect(off.status).toBe(200);
  });

  it("reset de centro devuelve 202", async () => {
    const res = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ name: "reset-center" }),
    });
    expect(res.status).toBe(202);
  });

  it("desactiva fuerzas y verifica tras el reinicio", async () => {
    const safety = once(device, "safety");
    const res = await api("/api/safety/disable-forces", { method: "POST" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      restarting: boolean;
      settings: { hardware: { forceEnabled: number } };
    };
    expect(body.restarting).toBe(true);
    expect(body.settings.hardware.forceEnabled).toBe(0);

    const [info] = (await safety) as [{ ok: boolean; message: string }];
    expect(info.ok).toBe(true);
    expect(info.message).toContain("verificadas");
    await waitFor(
      () => device.connected && device.getSettings()?.hardware.forceEnabled === 0,
    );
  });

  it("no desactiva fuerzas en solo lectura", async () => {
    const on = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ readOnly: true }),
    });
    expect(on.status).toBe(200);
    const blocked = await api("/api/safety/disable-forces", { method: "POST" });
    expect(blocked.status).toBe(403);
    const off = await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ readOnly: false }),
    });
    expect(off.status).toBe(200);
  });

  it("no desactiva fuerzas si guardar está desactivado", async () => {
    const previous = config.allowSaveCommand;
    config.allowSaveCommand = false;
    try {
      await expect(device.disableForces()).rejects.toMatchObject({
        status: 403,
        code: "command_disabled",
      });
    } finally {
      config.allowSaveCommand = previous;
    }
  });

  it("solo el PC puede quitar el modo solo lectura", () => {
    expect(canDisableReadOnly(false, true, false)).toBe(false);
    expect(canDisableReadOnly(true, true, false)).toBe(true);
    expect(canDisableReadOnly(false, true, true)).toBe(true);
    expect(canDisableReadOnly(false, false, false)).toBe(true);
  });

  it("dfu está desactivado", async () => {
    const res = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ name: "dfu" }),
    });
    expect(res.status).toBe(403);
  });

  it("expone el token solo en loopback", async () => {
    const res = await api("/api/token");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toBe(TOKEN);
  });

  it("genera el QR como PNG", async () => {
    const res = await api("/api/qr");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(200);
    expect(buffer.subarray(1, 4).toString()).toBe("PNG");
  });

  it("diagnóstico incluye estado y LAN", async () => {
    const res = await api("/api/diagnostics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mock: boolean; connected: boolean; lan: unknown[] };
    expect(body.mock).toBe(true);
    expect(body.connected).toBe(true);
    expect(Array.isArray(body.lan)).toBe(true);
  });

  it("descarga un ZIP de diagnóstico con el token redactado", async () => {
    const res = await api("/api/diagnostics/download");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/zip");
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.subarray(0, 2).toString()).toBe("PK");

    const files = unzipSync(new Uint8Array(buffer));
    const configText = strFromU8(files["config.redacted.json"] as Uint8Array);
    expect(configText).not.toContain(TOKEN);
    expect(configText).toContain("[redacted]");
    expect(files["hub.log"]).toBeDefined();
  });

  it("publica estado por WebSocket", async () => {
    const messages: Array<{ type: string; data: unknown }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${new URL(base).port}/api/ws?t=${TOKEN}`);
    ws.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()) as { type: string; data: unknown });
    });
    await once(ws, "open");
    await waitFor(() => messages.some((m) => m.type === "hello"));
    await waitFor(() => messages.some((m) => m.type === "status"));
    await waitFor(() => messages.some((m) => m.type === "settings"));
    await waitFor(() => messages.some((m) => m.type === "state"));
    ws.close();
    expect(messages.length).toBeGreaterThan(3);
  });

  it("rechaza WebSocket sin token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${new URL(base).port}/api/ws`);
    const outcome = await Promise.race([
      once(ws, "error").then(() => "error"),
      once(ws, "close").then(() => "close"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 3000)),
    ]);
    expect(outcome).not.toBe("timeout");
  });

  it("404 en ruta API desconocida", async () => {
    const res = await api("/api/no-existe");
    expect(res.status).toBe(404);
  });

  it("aplica rate limit", async () => {
    let limited = false;
    for (let i = 0; i < 60; i += 1) {
      const res = await fetch(`${base}/api/status`, { headers: authHeaders() });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
