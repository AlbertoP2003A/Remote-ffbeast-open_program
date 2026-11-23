import fs from "node:fs";
import path from "node:path";
import type { LogLevel } from "./hid/types.js";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MAX_BYTES = 1_000_000;
const KEEP_FILES = 3;

export interface Logger {
  readonly file: string;
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): Logger;
  recentLines(count: number): string[];
}

function formatMeta(meta: unknown): string {
  if (meta === undefined) return "";
  if (meta instanceof Error) return ` ${meta.stack ?? meta.message}`;
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

function stamp(): string {
  return new Date().toISOString();
}

export function createLogger(options: { dir: string; level: LogLevel; file?: string }): Logger {
  const file = options.file ?? path.join(options.dir, "hub.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });

  function rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(file)) return;
      if (fs.statSync(file).size < MAX_BYTES) return;
      for (let i = KEEP_FILES - 1; i >= 1; i -= 1) {
        const from = `${file}.${i}`;
        const to = `${file}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.renameSync(file, `${file}.1`);
    } catch {
      // Un fallo rotando no debe tumbar el hub.
    }
  }

  function write(level: LogLevel, scope: string, message: string, meta?: unknown): void {
    if (ORDER[level] < ORDER[options.level]) return;
    const line = `${stamp()} ${level.toUpperCase().padEnd(5)} ${scope} ${message}${formatMeta(meta)}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    try {
      rotateIfNeeded();
      fs.appendFileSync(file, `${line}\n`, "utf8");
    } catch {
      // Si el disco falla, al menos queda la consola.
    }
  }

  function make(scope: string): Logger {
    return {
      file,
      debug: (m, meta) => write("debug", scope, m, meta),
      info: (m, meta) => write("info", scope, m, meta),
      warn: (m, meta) => write("warn", scope, m, meta),
      error: (m, meta) => write("error", scope, m, meta),
      child: (sub) => make(`${scope}/${sub}`),
      recentLines: (count) => recentLines(count),
    };
  }

  function recentLines(count: number): string[] {
    try {
      if (!fs.existsSync(file)) return [];
      return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).slice(-count);
    } catch {
      return [];
    }
  }

  return make("hub");
}
