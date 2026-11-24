import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFLICT_PROCESSES } from "./domain/conflict.js";
import type { AppConfig, LogLevel } from "./hid/types.js";

export const VERSION = "1.0.0";

export function appDataDir(): string {
  if (process.env.FFBEAST_DATA_DIR) return path.resolve(process.env.FFBEAST_DATA_DIR);
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "ffbeast-remote");
  }
  return path.join(os.homedir(), ".config", "ffbeast-remote");
}

export function configPath(): string {
  return path.join(appDataDir(), "config.json");
}

export function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function defaultConfig(): AppConfig {
  return {
    version: 1,
    port: 47100,
    token: newToken(),
    readOnly: false,
    allowSaveCommand: true,
    allowRebootCommand: false,
    allowDfuCommand: false,
    stateHz: 20,
    logLevel: "info",
    mock: false,
    conflictProcesses: [...DEFAULT_CONFLICT_PROCESSES],
  };
}

function asBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return /^(1|true|yes|on)$/i.test(value);
}

function applyEnv(config: AppConfig): AppConfig {
  const next = { ...config };
  if (process.env.FFBEAST_PORT) {
    const port = Number(process.env.FFBEAST_PORT);
    if (Number.isInteger(port) && port > 0 && port < 65536) next.port = port;
  }
  if (process.env.FFBEAST_TOKEN) next.token = process.env.FFBEAST_TOKEN;
  if (process.env.FFBEAST_READ_ONLY !== undefined) {
    next.readOnly = asBool(process.env.FFBEAST_READ_ONLY) ?? next.readOnly;
  }
  if (process.env.FFBEAST_MOCK !== undefined) {
    next.mock = asBool(process.env.FFBEAST_MOCK) ?? next.mock;
  }
  if (process.env.FFBEAST_STATE_HZ) {
    const hz = Number(process.env.FFBEAST_STATE_HZ);
    if (Number.isFinite(hz) && hz >= 1 && hz <= 60) next.stateHz = hz;
  }
  if (process.env.FFBEAST_LOG_LEVEL) {
    const level = process.env.FFBEAST_LOG_LEVEL.toLowerCase();
    if (["debug", "info", "warn", "error"].includes(level)) next.logLevel = level as LogLevel;
  }
  return next;
}

export function saveConfig(config: AppConfig): void {
  const dir = appDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "config.json");
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function loadConfig(): AppConfig {
  const dir = appDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "config.json");
  const defaults = defaultConfig();
  let stored: Partial<AppConfig> = {};

  if (fs.existsSync(target)) {
    try {
      stored = JSON.parse(fs.readFileSync(target, "utf8")) as Partial<AppConfig>;
    } catch {
      // Config corrupta: se reescribe con los valores por defecto.
    }
  }

  const base: AppConfig = {
    ...defaults,
    ...stored,
    version: 1,
    token: stored.token && stored.token.length >= 16 ? stored.token : defaults.token,
  };
  const config = applyEnv(base);

  // Se guarda la configuracion base (sin overrides de entorno) para que, por
  // ejemplo, FFBEAST_MOCK=1 no deje el modo simulado activado para siempre.
  if (!fs.existsSync(target) || JSON.stringify(stored) !== JSON.stringify(base)) {
    saveConfig(base);
  }
  return config;
}
