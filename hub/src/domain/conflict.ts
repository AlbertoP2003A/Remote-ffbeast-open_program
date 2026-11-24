import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ConflictInfo } from "../hid/types.js";
import type { Logger } from "../log.js";

const execFileAsync = promisify(execFile);

/** Programas conocidos que tambien pueden escribir en el volante. */
export const DEFAULT_CONFLICT_PROCESSES = [
  "PitHouse.exe",
  "Pit House.exe",
  "FFBeast Pit House.exe",
  "FFBeastPitHouse.exe",
];

export function parseTasklist(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^"([^"]+)"/.exec(line.trim());
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

/** Normaliza "FFBeast Pit House.exe" y "PitHouse.exe" a algo comparable. */
export function normalizeProcessName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .replace(/[^a-z0-9]/g, "");
}

export function processMatches(candidate: string, target: string): boolean {
  const left = normalizeProcessName(candidate);
  const right = normalizeProcessName(target);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

async function listWindowsProcesses(): Promise<string[]> {
  const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], {
    windowsHide: true,
    timeout: 3000,
    maxBuffer: 1024 * 1024,
  });
  return parseTasklist(stdout);
}

export interface ConflictMonitorOptions {
  processes: string[];
  log: Logger;
  intervalMs?: number;
  /** Inyectable para tests; por defecto usa tasklist en Windows. */
  listProcesses?: () => Promise<string[]>;
}

/**
 * Vigila procesos que podrian estar escribiendo en el volante a la vez.
 * Es un aviso: no bloquea escrituras, pero deja constancia en la UI.
 */
export class ConflictMonitor {
  private info: ConflictInfo = {
    active: false,
    process: null,
    checkedAt: null,
  };
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<(info: ConflictInfo) => void>();
  private readonly listProcesses: () => Promise<string[]>;

  constructor(private readonly options: ConflictMonitorOptions) {
    this.listProcesses =
      options.listProcesses ??
      (process.platform === "win32"
        ? listWindowsProcesses
        : async () => []);
  }

  start(): void {
    if (this.timer || this.options.processes.length === 0) return;
    void this.check();
    this.timer = setInterval(
      () => void this.check(),
      this.options.intervalMs ?? 5000,
    );
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  current(): ConflictInfo {
    return this.info;
  }

  onChange(listener: (info: ConflictInfo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async check(): Promise<void> {
    try {
      const names = await this.listProcesses();
      const found = names.find((name) =>
        this.options.processes.some((target) => processMatches(name, target)),
      );
      const next: ConflictInfo = {
        active: Boolean(found),
        process: found ?? null,
        checkedAt: Date.now(),
      };
      const changed =
        next.active !== this.info.active || next.process !== this.info.process;
      this.info = next;
      if (!changed) return;

      if (next.active) {
        this.options.log.warn(
          `Programa en conflicto detectado: ${next.process}. Cierra Pit House o este hub.`,
        );
      } else {
        this.options.log.info("El programa en conflicto ya no esta abierto");
      }
      for (const listener of this.listeners) listener(next);
    } catch (error) {
      // tasklist puede fallar puntualmente; no es un error del hub.
      this.options.log.debug(
        `No se pudo comprobar el conflicto de procesos: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
