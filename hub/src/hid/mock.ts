import {
  encodeAdc,
  encodeEffects,
  encodeGpio,
  encodeHardware,
  encodeLicense,
  encodeState,
  toInt,
} from "./codec.js";
import { fieldById, withValue } from "./fields.js";
import type { DeviceSettings, LicenseInfo } from "./types.js";
import { USB_PID, USB_VID } from "./constants.js";
import type { HidDeviceInfo, HidTransport, TransportFactory } from "./transport.js";

export interface MockState {
  settings: DeviceSettings;
  license: LicenseInfo;
  position: number;
  torque: number;
  connected: boolean;
  /** Campos que el dispositivo simulado ignora, para probar el read-back. */
  ignoreFields?: Set<string>;
}

export function defaultMockSettings(): DeviceSettings {
  return {
    effects: {
      motionRange: 900,
      staticDampeningStrength: 10,
      softStopDampeningStrength: 20,
      dynamicDampeningStrength: 0,
      totalEffectStrength: 100,
      integratedSpringStrength: 0,
      softStopRange: 10,
      softStopStrength: 100,
      directXConstantDirection: 1,
      directXSpringStrength: 100,
      directXConstantStrength: 100,
      directXPeriodicStrength: 100,
    },
    hardware: {
      encoderCpr: 4096,
      integralGain: 100,
      proportionalGain: 10,
      forceEnabled: 1,
      debugTorque: 0,
      amplifierGain: 1,
      calibrationMagnitude: 50,
      calibrationSpeed: 50,
      powerLimit: 80,
      brakingLimit: 50,
      positionSmoothing: 10,
      speedBufferSize: 10,
      encoderDirection: 1,
      forceDirection: 1,
      polePairs: 7,
    },
    gpio: {
      extensionMode: 0,
      pinMode: Array.from({ length: 10 }, () => 0),
      buttonMode: Array.from({ length: 32 }, () => 1),
      spiMode: 0,
      spiLatchMode: 0,
      spiLatchDelay: 0,
      spiClkPulseLength: 0,
    },
    adc: {
      adcMinDeadZone: [0, 0, 0],
      adcMaxDeadZone: [65535, 65535, 65535],
      adcSmoothing: [0, 0, 0],
      adcToButtonLow: [0, 0, 0],
      adcToButtonHigh: [100, 100, 100],
      adcInvert: [0, 0, 0],
    },
  };
}

export function defaultMockLicense(): LicenseInfo {
  return {
    releaseType: 0,
    major: 26,
    minor: 1,
    patch: 1,
    serialKey: [0x12345678, 0x23456789, 0x3456789a],
    deviceId: [0xaaaa1111, 0xbbbb2222, 0xcccc3333],
    isRegistered: true,
  };
}

const TICK_MS = 20; // 50 Hz; el hub decide a cuantos Hz publica.

class MockTransport implements HidTransport {
  private timer: NodeJS.Timeout | null = null;
  private dataCbs = new Set<(payload: Buffer) => void>();
  private errorCbs = new Set<(error: Error) => void>();
  private startedAt = Date.now();

  constructor(private state: MockState) {}

  write(data: Buffer): void {
    if (data.length < 4) return;
    if (data[1] === 0x14) {
      const fieldId = data[2];
      const index = data[3];
      const def = fieldById(fieldId);
      if (!def) return;
      if (this.state.ignoreFields?.has(def.name)) return;
      let value = data.readUInt8(4);
      if (def.type === "i8") value = data.readInt8(4);
      else if (def.type === "u16") value = data.readUInt16LE(4);
      else if (def.type === "i16") value = data.readInt16LE(4);
      this.state.settings = withValue(this.state.settings, def.name, toInt(value), index);
      return;
    }
    if (data[1] === 0x04) {
      // Reset de centro: el volante queda en 0.
      this.state.position = 0;
    }
  }

  getFeatureReport(reportId: number): Buffer {
    switch (reportId) {
      case 0x21:
        return encodeHardware(this.state.settings.hardware);
      case 0x22:
        return encodeEffects(this.state.settings.effects);
      case 0xa1:
        return encodeGpio(this.state.settings.gpio);
      case 0xa2:
        return encodeAdc(this.state.settings.adc);
      case 0x25:
        return encodeLicense(this.state.license);
      default:
        return Buffer.alloc(64);
    }
  }

  onData(cb: (payload: Buffer) => void): void {
    this.dataCbs.add(cb);
    this.start();
  }

  onError(cb: (error: Error) => void): void {
    this.errorCbs.add(cb);
  }

  close(): void {
    this.stop();
    this.dataCbs.clear();
    this.errorCbs.clear();
  }

  private start(): void {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const t = (Date.now() - this.startedAt) / 1000;
    const range = this.state.settings.effects.motionRange || 900;
    // Movimiento suave de demostracion, sin tocar la posicion real.
    const position = Math.round(Math.sin(t * 1.4) * 8500);
    const torque = Math.round(Math.cos(t * 1.4) * 2500 + (range - 900) * 2);
    this.state.position = position;
    this.state.torque = torque;
    const payload = encodeState({
      releaseType: this.state.license.releaseType,
      major: this.state.license.major,
      minor: this.state.license.minor,
      patch: this.state.license.patch,
      isRegistered: this.state.license.isRegistered,
      position,
      torque,
    });
    for (const cb of this.dataCbs) cb(payload);
  }
}

/**
 * Dispositivo simulado: permite desarrollar la UI sin el volante conectado.
 * Se activa con FFBEAST_MOCK=1.
 */
export class MockFactory implements TransportFactory {
  readonly kind = "mock" as const;
  readonly state: MockState;

  constructor(state?: Partial<MockState>) {
    this.state = {
      settings: state?.settings ?? defaultMockSettings(),
      license: state?.license ?? defaultMockLicense(),
      position: state?.position ?? 0,
      torque: state?.torque ?? 0,
      connected: state?.connected ?? true,
      ignoreFields: state?.ignoreFields,
    };
  }

  list(): HidDeviceInfo[] {
    return [
      {
        path: "mock://ffbeast-wheel",
        vendorId: USB_VID,
        productId: USB_PID,
        interface: 0,
        product: "FFBeast Wheel (simulado)",
      },
    ];
  }

  find(): HidDeviceInfo | null {
    return this.state.connected ? (this.list()[0] ?? null) : null;
  }

  open(path: string): HidTransport {
    if (path !== "mock://ffbeast-wheel") throw new Error(`Ruta simulada desconocida: ${path}`);
    return new MockTransport(this.state);
  }
}
