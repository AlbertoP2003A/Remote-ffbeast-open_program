import { describe, expect, it } from "vitest";
import type { Logger } from "../src/log.js";
import {
  ConflictMonitor,
  normalizeProcessName,
  parseTasklist,
  processMatches,
} from "../src/domain/conflict.js";

function silentLogger(): Logger {
  const logger: Logger = {
    file: "",
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
    recentLines: () => [],
  };
  return logger;
}

describe("conflicto de procesos", () => {
  it("parsea la salida CSV de tasklist", () => {
    const output =
      '"PitHouse.exe","1234","Console","1","10.000 K"\r\n' +
      '"chrome.exe","5678","Console","1","100.000 K"\r\n';
    expect(parseTasklist(output)).toEqual(["PitHouse.exe", "chrome.exe"]);
  });

  it("normaliza nombres con espacios y extensión", () => {
    expect(normalizeProcessName("FFBeast Pit House.exe")).toBe("ffbeastpithouse");
    expect(normalizeProcessName("PitHouse.EXE")).toBe("pithouse");
    expect(processMatches("FFBeast Pit House.exe", "PitHouse.exe")).toBe(true);
    expect(processMatches("notepad.exe", "PitHouse.exe")).toBe(false);
  });

  it("detecta un proceso en conflicto con una lista inyectada", async () => {
    const monitor = new ConflictMonitor({
      processes: ["PitHouse.exe"],
      log: silentLogger(),
      intervalMs: 5,
      listProcesses: async () => ["FFBeast Pit House.exe"],
    });
    monitor.start();
    const started = Date.now();
    while (!monitor.current().active && Date.now() - started < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(monitor.current().active).toBe(true);
    expect(monitor.current().process).toBe("FFBeast Pit House.exe");
    monitor.stop();
  });
});
