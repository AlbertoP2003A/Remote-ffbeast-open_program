import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Auth } from "./auth.js";
import type { WheelDevice } from "../hid/driver.js";
import type { JoystickLike } from "../hid/joystick.js";
import type { Logger } from "../log.js";
import type { AppConfig } from "../hid/types.js";
import { VERSION } from "../config.js";
import { FIELDS } from "../hid/fields.js";
import type { ConflictMonitor } from "../domain/conflict.js";

interface WsDeps {
  auth: Auth;
  device: WheelDevice;
  joystick: JoystickLike;
  conflict: ConflictMonitor;
  log: Logger;
  config: AppConfig;
}

export class WsHub {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly clients = new Set<WebSocket>();
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private stateTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastStateTimestamp = 0;
  private unsubscribeConflict: (() => void) | null = null;

  constructor(private readonly deps: WsDeps) {
    this.wss.on("connection", (ws) => this.onConnection(ws));
    this.bindDevice();
    this.unsubscribeConflict = deps.conflict.onChange(() =>
      this.broadcast("status", this.statusPayload()),
    );
    const interval = Math.max(50, Math.round(1000 / Math.max(1, deps.config.stateHz)));
    this.stateTimer = setInterval(() => this.pushState(), interval);
    this.stateTimer.unref?.();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
    this.heartbeatTimer.unref?.();
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!this.deps.auth.isAuthenticated(req, url)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit("connection", ws, req);
    });
  }

  broadcast(type: string, data: unknown): void {
    if (this.clients.size === 0) return;
    const message = JSON.stringify({ type, data });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  }

  close(): void {
    if (this.stateTimer) clearInterval(this.stateTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.stateTimer = null;
    this.heartbeatTimer = null;
    this.unsubscribeConflict?.();
    this.unsubscribeConflict = null;
    for (const client of this.clients) {
      try {
        client.close(1001, "hub cerrado");
      } catch {
        // ya cerrado
      }
    }
    this.clients.clear();
    this.wss.close();
  }

  // ------------------------------------------------------------------ interno

  private onConnection(ws: WebSocket): void {
    this.clients.add(ws);
    this.alive.set(ws, true);
    this.deps.log.debug(`WebSocket conectado (${this.clients.size} clientes)`);

    ws.on("pong", () => this.alive.set(ws, true));
    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string };
        if (message.type === "ping") this.send(ws, "pong", { at: Date.now() });
      } catch {
        // ignorar mensajes mal formados
      }
    });
    ws.on("close", () => {
      this.clients.delete(ws);
      this.deps.log.debug(`WebSocket desconectado (${this.clients.size} clientes)`);
    });
    ws.on("error", (error) => {
      this.deps.log.debug("Error de WebSocket", error.message);
      this.clients.delete(ws);
    });

    this.send(ws, "hello", { version: VERSION, api: 1 });
    this.send(ws, "status", this.statusPayload());
    this.send(ws, "fields", { fields: FIELDS });
    const settings = this.deps.device.getSettings();
    if (settings) this.send(ws, "settings", { settings });
    const live = this.deps.device.getLive();
    if (live) this.send(ws, "state", { ...live, axes: this.deps.joystick.getAxes() });
  }

  private send(ws: WebSocket, type: string, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  }

  private pushState(): void {
    if (this.clients.size === 0 || !this.deps.device.connected) return;
    const live = this.deps.device.getLive();
    if (!live || live.timestamp === this.lastStateTimestamp) return;
    this.lastStateTimestamp = live.timestamp;
    this.broadcast("state", { ...live, axes: this.deps.joystick.getAxes() });
  }

  private heartbeat(): void {
    for (const client of this.clients) {
      if (this.alive.get(client) === false) {
        client.terminate();
        this.clients.delete(client);
        continue;
      }
      this.alive.set(client, false);
      try {
        client.ping();
      } catch {
        client.terminate();
        this.clients.delete(client);
      }
    }
  }

  private statusPayload(): unknown {
    return {
      ...this.deps.device.status(),
      conflict: this.deps.conflict.current(),
    };
  }

  private bindDevice(): void {
    const { device } = this.deps;
    device.on("connected", () => this.broadcast("status", this.statusPayload()));
    device.on("disconnected", () => this.broadcast("status", this.statusPayload()));
    device.on("license", () => this.broadcast("status", this.statusPayload()));
    device.on("health", () => this.broadcast("status", this.statusPayload()));
    device.on("settings", (settings) => this.broadcast("settings", { settings }));
    device.on("safety", (info: unknown) => this.broadcast("safety", info));
    device.on("error", (error: Error) => this.broadcast("error", { message: error.message }));
  }
}
