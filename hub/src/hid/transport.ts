import { createRequire } from "node:module";
import { PAYLOAD_SIZE, REPORT_ID, USAGE_PAGE, USB_PID, USB_VID } from "./constants.js";
import { stripReportId } from "./codec.js";

export interface HidDeviceInfo {
  path: string;
  vendorId: number;
  productId: number;
  interface?: number;
  usagePage?: number;
  product?: string;
}

export interface HidTransport {
  write(data: Buffer): void;
  /** Devuelve 64 bytes de payload, sin el report id. */
  getFeatureReport(reportId: number): Buffer;
  onData(cb: (payload: Buffer) => void): void;
  onError(cb: (error: Error) => void): void;
  close(): void;
}

export interface TransportFactory {
  readonly kind: "node-hid" | "mock";
  list(): HidDeviceInfo[];
  find(): HidDeviceInfo | null;
  open(path: string): HidTransport;
}

// ---------------------------------------------------------------------------
// node-hid
// ---------------------------------------------------------------------------

export interface NodeHidDevice {
  write(data: Buffer | number[]): number;
  getFeatureReport(reportId: number, length?: number): Buffer;
  on(event: "data", cb: (data: Buffer) => void): this;
  on(event: "error", cb: (error: Error) => void): this;
  close(): void;
}

export interface NodeHidModule {
  devices(): Array<{
    path?: string;
    vendorId: number;
    productId: number;
    interface?: number;
    usagePage?: number;
    product?: string;
  }>;
  HID: new (path: string) => NodeHidDevice;
}

const require = createRequire(import.meta.url);
let nodeHid: NodeHidModule | null = null;

export function loadNodeHid(): NodeHidModule {
  if (nodeHid) return nodeHid;
  // Carga perezosa: si el modulo nativo falta, el hub puede seguir en modo mock
  // o mostrar un error claro en lugar de no arrancar.
  nodeHid = require("node-hid") as NodeHidModule;
  return nodeHid;
}

export class NodeHidFactory implements TransportFactory {
  readonly kind = "node-hid" as const;

  list(): HidDeviceInfo[] {
    const HID = loadNodeHid();
    return HID.devices()
      .filter((d) => typeof d.path === "string" && d.path.length > 0)
      .map((d) => ({
        path: d.path as string,
        vendorId: d.vendorId,
        productId: d.productId,
        interface: d.interface,
        usagePage: d.usagePage,
        product: d.product,
      }));
  }

  find(): HidDeviceInfo | null {
    const devices = this.list();
    const wheel = devices.filter(
      (d) =>
        d.vendorId === USB_VID &&
        d.productId === USB_PID &&
        (d.interface === undefined || d.interface === 0 || d.usagePage === USAGE_PAGE),
    );
    return wheel[0] ?? null;
  }

  open(path: string): HidTransport {
    const HID = loadNodeHid();
    const dev = new HID.HID(path);
    return {
      write: (data) => {
        dev.write(data);
      },
      getFeatureReport: (reportId) => {
        const raw = dev.getFeatureReport(reportId, 1 + PAYLOAD_SIZE);
        return stripReportId(Buffer.from(raw), reportId);
      },
      onData: (cb) => {
        dev.on("data", (raw: Buffer) => {
          const buffer = Buffer.from(raw);
          // El estado del volante llega por el reporte generico 0xA3. Cualquier
          // otro reporte (p. ej. joystick) se ignora.
          if (buffer.length < 2 || buffer[0] !== REPORT_ID.generic) return;
          cb(buffer.subarray(1, 1 + PAYLOAD_SIZE));
        });
      },
      onError: (cb) => {
        dev.on("error", cb);
      },
      close: () => {
        try {
          dev.close();
        } catch {
          // ya cerrado
        }
      },
    };
  }
}
