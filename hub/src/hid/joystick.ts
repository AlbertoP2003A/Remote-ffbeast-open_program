import type { JoystickAxes } from "./types.js";
import { REPORT_ID, USB_PID, USB_VID } from "./constants.js";
import { loadNodeHid, type NodeHidDevice } from "./transport.js";
import type { Logger } from "../log.js";
import { errorMessage } from "../errors.js";

export interface JoystickLike {
  start(): void;
  stop(): void;
  getAxes(): JoystickAxes | null;
}

const AXIS_START = 9; // report id (1) + 64 botones (8 bytes)
const REPORT_SIZE = 25; // 1 + 8 + 8 ejes * 2

/**
 * Lee la interfaz HID de joystick (interface 1) del volante.
 * El descriptor del firmware expone 64 botones y 8 ejes de 16 bits:
 * X, Y, Z, Rx, Ry, Rz, Slider, Dial.
 */
export class JoystickDevice implements JoystickLike {
  private dev: NodeHidDevice | null = null;
  private timer: NodeJS.Timeout | null = null;
  private axes: JoystickAxes | null = null;
  private connecting = false;
  private stopped = false;
  private lastError: string | null = null;

  constructor(
    private readonly log: Logger,
    private readonly reconnectMs = 1500,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    void this.tryConnect();
    this.timer = setInterval(() => {
      void this.tryConnect();
    }, this.reconnectMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.drop("hub detenido");
  }

  getAxes(): JoystickAxes | null {
    return this.axes;
  }

  private async tryConnect(): Promise<void> {
    if (this.dev || this.stopped || this.connecting) return;
    this.connecting = true;
    try {
      const HID = loadNodeHid();
      const info = HID.devices().find(
        (device) =>
          device.vendorId === USB_VID &&
          device.productId === USB_PID &&
          device.interface === 1,
      );
      if (!info || !info.path) {
        this.axes = null;
        return;
      }
      const dev = new HID.HID(info.path);
      dev.on("data", (raw) => this.decode(raw));
      dev.on("error", (error) => {
        this.log.warn("Error de la interfaz de joystick", error.message);
        this.drop(error.message);
      });
      this.dev = dev;
      this.lastError = null;
      this.log.info("Interfaz de joystick conectada");
    } catch (error) {
      const message = errorMessage(error);
      if (message !== this.lastError) {
        this.lastError = message;
        this.log.warn("No se pudo abrir la interfaz de joystick", message);
      }
    } finally {
      this.connecting = false;
    }
  }

  private decode(raw: Buffer): void {
    const buffer = Buffer.from(raw);
    if (buffer.length < REPORT_SIZE || buffer[0] !== REPORT_ID.joystick) return;

    const axes: JoystickAxes = {
      x: buffer.readInt16LE(AXIS_START),
      y: buffer.readInt16LE(AXIS_START + 2),
      z: buffer.readInt16LE(AXIS_START + 4),
      rx: buffer.readInt16LE(AXIS_START + 6),
      ry: buffer.readInt16LE(AXIS_START + 8),
      rz: buffer.readInt16LE(AXIS_START + 10),
      slider: buffer.readInt16LE(AXIS_START + 12),
      dial: buffer.readInt16LE(AXIS_START + 14),
      buttons: [],
      timestamp: Date.now(),
    };

    for (let i = 0; i < 64; i += 1) {
      if (buffer[1 + (i >> 3)] & (1 << (i & 7))) axes.buttons.push(i + 1);
    }
    this.axes = axes;
  }

  private drop(reason: string): void {
    if (!this.dev) return;
    const dev = this.dev;
    this.dev = null;
    this.axes = null;
    try {
      dev.close();
    } catch {
      // ya cerrado
    }
    this.log.warn(`Interfaz de joystick desconectada: ${reason}`);
  }
}

/** Ejes animados para el modo simulado. */
export class MockJoystick implements JoystickLike {
  private timer: NodeJS.Timeout | null = null;
  private axes: JoystickAxes | null = null;

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 20);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getAxes(): JoystickAxes | null {
    return this.axes;
  }

  private tick(): void {
    const t = Date.now() / 1000;
    const axis = (value: number): number =>
      Math.max(-32767, Math.min(32767, Math.round(value)));
    this.axes = {
      x: axis(Math.sin(t * 1.4) * 30000),
      y: 0,
      z: 0,
      rx: axis(((Math.sin(t * 0.9) + 1) / 2) * 32767),
      ry: axis(((Math.sin(t * 0.6 + 1) + 1) / 2) * 32767),
      rz: axis(((Math.sin(t * 0.4 + 2) + 1) / 2) * 32767),
      slider: 0,
      dial: 0,
      buttons: [],
      timestamp: Date.now(),
    };
  }
}
