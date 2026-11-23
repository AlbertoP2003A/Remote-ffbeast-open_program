import {
  DATA_TYPE,
  PAYLOAD_SIZE,
  REPORT_ID,
  REPORT_SIZE,
} from "./constants.js";
import type {
  AdcSettings,
  DeviceSettings,
  EffectsSettings,
  FieldType,
  GpioSettings,
  HardwareSettings,
  LicenseInfo,
  LiveState,
} from "./types.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function toInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error("El valor no es un numero valido");
  return Math.trunc(n);
}

/**
 * Respuesta de hidapi: en Windows el primer byte es el report id.
 * Si viene incluido, lo quitamos; si ya viene como payload puro, se deja.
 */
export function stripReportId(buf: Buffer, reportId: number): Buffer {
  if (buf.length > PAYLOAD_SIZE && buf[0] === reportId) {
    return buf.subarray(1, 1 + PAYLOAD_SIZE);
  }
  return buf.length > PAYLOAD_SIZE ? buf.subarray(0, PAYLOAD_SIZE) : buf;
}

function ensurePayload(buf: Buffer, bytes: number, name: string): Buffer {
  if (buf.length < bytes) {
    throw new Error(`Reporte ${name} demasiado corto: ${buf.length} bytes (min ${bytes})`);
  }
  return buf;
}

/**
 * Escritura de un ajuste (65 bytes en el cable):
 * [0]=0xA3 [1]=0x14 [2]=FieldId [3]=Index [4..]=valor LE
 */
export function encodeSetting(
  fieldId: number,
  index: number,
  type: FieldType,
  value: number,
): Buffer {
  const buf = Buffer.alloc(REPORT_SIZE);
  buf[0] = REPORT_ID.generic;
  buf[1] = DATA_TYPE.settingsField;
  buf[2] = fieldId & 0xff;
  buf[3] = index & 0xff;

  const v = toInt(value);
  switch (type) {
    case "u8":
      buf.writeUInt8(clamp(v, 0, 0xff), 4);
      break;
    case "i8":
      buf.writeInt8(clamp(v, -0x80, 0x7f), 4);
      break;
    case "u16":
      buf.writeUInt16LE(clamp(v, 0, 0xffff), 4);
      break;
    case "i16":
      buf.writeInt16LE(clamp(v, -0x8000, 0x7fff), 4);
      break;
  }
  return buf;
}

export type CommandName = "reboot" | "save" | "dfu" | "reset-center";

/** Comandos: [0]=0xA3 [1]=comando. */
export function encodeCommand(name: CommandName): Buffer {
  const buf = Buffer.alloc(REPORT_SIZE);
  buf[0] = REPORT_ID.generic;
  switch (name) {
    case "reboot":
      buf[1] = DATA_TYPE.reboot;
      break;
    case "save":
      buf[1] = DATA_TYPE.save;
      break;
    case "dfu":
      buf[1] = DATA_TYPE.dfu;
      break;
    case "reset-center":
      buf[1] = DATA_TYPE.resetCenter;
      break;
    default:
      throw new Error(`Comando desconocido: ${String(name)}`);
  }
  return buf;
}

/** Control directo (test de fuerzas): [0]=A3 [1]=10 [2..3] spring [4..5] constant [6..7] periodic [8] drop. */
export function encodeDirectControl(input: {
  springForce?: number;
  constantForce?: number;
  periodicForce?: number;
  forceDrop?: number;
}): Buffer {
  const buf = Buffer.alloc(REPORT_SIZE);
  buf[0] = REPORT_ID.generic;
  buf[1] = DATA_TYPE.directControl;
  buf.writeInt16LE(clamp(toInt(input.springForce ?? 0), -10000, 10000), 2);
  buf.writeInt16LE(clamp(toInt(input.constantForce ?? 0), -10000, 10000), 4);
  buf.writeInt16LE(clamp(toInt(input.periodicForce ?? 0), -10000, 10000), 6);
  buf.writeUInt8(clamp(toInt(input.forceDrop ?? 0), 0, 100), 8);
  return buf;
}

export function decodeState(payload: Buffer): Omit<
  LiveState,
  | "positionDegrees"
  | "positionPercent"
  | "positionNormalized"
  | "torqueNormalized"
  | "torquePercent"
  | "timestamp"
> {
  ensurePayload(payload, 9, "state");
  return {
    releaseType: payload.readUInt8(0),
    major: payload.readUInt8(1),
    minor: payload.readUInt8(2),
    patch: payload.readUInt8(3),
    isRegistered: payload.readUInt8(4) !== 0,
    position: payload.readInt16LE(5),
    torque: payload.readInt16LE(7),
  };
}

export function decodeEffects(payload: Buffer): EffectsSettings {
  ensurePayload(payload, 16, "effects");
  return {
    motionRange: payload.readUInt16LE(0),
    staticDampeningStrength: payload.readUInt16LE(2),
    softStopDampeningStrength: payload.readUInt16LE(4),
    dynamicDampeningStrength: payload.readUInt16LE(14),
    totalEffectStrength: payload.readUInt8(6),
    integratedSpringStrength: payload.readUInt8(7),
    softStopRange: payload.readUInt8(8),
    softStopStrength: payload.readUInt8(9),
    directXConstantDirection: payload.readInt8(10),
    directXSpringStrength: payload.readUInt8(11),
    directXConstantStrength: payload.readUInt8(12),
    directXPeriodicStrength: payload.readUInt8(13),
  };
}

export function decodeHardware(payload: Buffer): HardwareSettings {
  ensurePayload(payload, 17, "hardware");
  return {
    encoderCpr: payload.readUInt16LE(0),
    integralGain: payload.readUInt16LE(2),
    proportionalGain: payload.readUInt8(4),
    forceEnabled: payload.readUInt8(5),
    debugTorque: payload.readUInt8(6),
    amplifierGain: payload.readUInt8(7),
    calibrationMagnitude: payload.readUInt8(8),
    calibrationSpeed: payload.readUInt8(9),
    powerLimit: payload.readUInt8(10),
    brakingLimit: payload.readUInt8(11),
    positionSmoothing: payload.readUInt8(12),
    speedBufferSize: payload.readUInt8(13),
    encoderDirection: payload.readInt8(14),
    forceDirection: payload.readInt8(15),
    polePairs: payload.readUInt8(16),
  };
}

export function decodeGpio(payload: Buffer): GpioSettings {
  ensurePayload(payload, 47, "gpio");
  const pinMode: number[] = [];
  for (let i = 0; i < 10; i += 1) pinMode.push(payload.readUInt8(1 + i));
  const buttonMode: number[] = [];
  for (let i = 0; i < 32; i += 1) buttonMode.push(payload.readUInt8(11 + i));
  return {
    extensionMode: payload.readUInt8(0),
    pinMode,
    buttonMode,
    spiMode: payload.readUInt8(43),
    spiLatchMode: payload.readUInt8(44),
    spiLatchDelay: payload.readUInt8(45),
    spiClkPulseLength: payload.readUInt8(46),
  };
}

export function decodeAdc(payload: Buffer): AdcSettings {
  ensurePayload(payload, 24, "adc");
  const min: number[] = [];
  const max: number[] = [];
  const smooth: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  const invert: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    min.push(payload.readUInt16LE(0 + i * 2));
    max.push(payload.readUInt16LE(6 + i * 2));
    smooth.push(payload.readUInt8(12 + i));
    low.push(payload.readUInt8(15 + i));
    high.push(payload.readUInt8(18 + i));
    invert.push(payload.readUInt8(21 + i));
  }
  return {
    adcMinDeadZone: min,
    adcMaxDeadZone: max,
    adcSmoothing: smooth,
    adcToButtonLow: low,
    adcToButtonHigh: high,
    adcInvert: invert,
  };
}

export function decodeLicense(payload: Buffer): LicenseInfo {
  ensurePayload(payload, 29, "license");
  return {
    releaseType: payload.readUInt8(0),
    major: payload.readUInt8(1),
    minor: payload.readUInt8(2),
    patch: payload.readUInt8(3),
    serialKey: [
      payload.readUInt32LE(4),
      payload.readUInt32LE(8),
      payload.readUInt32LE(12),
    ],
    deviceId: [
      payload.readUInt32LE(16),
      payload.readUInt32LE(20),
      payload.readUInt32LE(24),
    ],
    isRegistered: payload.readUInt8(28) !== 0,
  };
}

// ---------------------------------------------------------------------------
// Codificadores de bloque: se usan para el dispositivo simulado y los tests.
// ---------------------------------------------------------------------------

export function encodeEffects(settings: EffectsSettings): Buffer {
  const buf = Buffer.alloc(PAYLOAD_SIZE);
  buf.writeUInt16LE(settings.motionRange, 0);
  buf.writeUInt16LE(settings.staticDampeningStrength, 2);
  buf.writeUInt16LE(settings.softStopDampeningStrength, 4);
  buf.writeUInt8(settings.totalEffectStrength, 6);
  buf.writeUInt8(settings.integratedSpringStrength, 7);
  buf.writeUInt8(settings.softStopRange, 8);
  buf.writeUInt8(settings.softStopStrength, 9);
  buf.writeInt8(settings.directXConstantDirection, 10);
  buf.writeUInt8(settings.directXSpringStrength, 11);
  buf.writeUInt8(settings.directXConstantStrength, 12);
  buf.writeUInt8(settings.directXPeriodicStrength, 13);
  buf.writeUInt16LE(settings.dynamicDampeningStrength, 14);
  return buf;
}

export function encodeHardware(settings: HardwareSettings): Buffer {
  const buf = Buffer.alloc(PAYLOAD_SIZE);
  buf.writeUInt16LE(settings.encoderCpr, 0);
  buf.writeUInt16LE(settings.integralGain, 2);
  buf.writeUInt8(settings.proportionalGain, 4);
  buf.writeUInt8(settings.forceEnabled, 5);
  buf.writeUInt8(settings.debugTorque, 6);
  buf.writeUInt8(settings.amplifierGain, 7);
  buf.writeUInt8(settings.calibrationMagnitude, 8);
  buf.writeUInt8(settings.calibrationSpeed, 9);
  buf.writeUInt8(settings.powerLimit, 10);
  buf.writeUInt8(settings.brakingLimit, 11);
  buf.writeUInt8(settings.positionSmoothing, 12);
  buf.writeUInt8(settings.speedBufferSize, 13);
  buf.writeInt8(settings.encoderDirection, 14);
  buf.writeInt8(settings.forceDirection, 15);
  buf.writeUInt8(settings.polePairs, 16);
  return buf;
}

export function encodeGpio(settings: GpioSettings): Buffer {
  const buf = Buffer.alloc(PAYLOAD_SIZE);
  buf.writeUInt8(settings.extensionMode, 0);
  for (let i = 0; i < 10; i += 1) buf.writeUInt8(settings.pinMode[i] ?? 0, 1 + i);
  for (let i = 0; i < 32; i += 1) buf.writeUInt8(settings.buttonMode[i] ?? 0, 11 + i);
  buf.writeUInt8(settings.spiMode, 43);
  buf.writeUInt8(settings.spiLatchMode, 44);
  buf.writeUInt8(settings.spiLatchDelay, 45);
  buf.writeUInt8(settings.spiClkPulseLength, 46);
  return buf;
}

export function encodeAdc(settings: AdcSettings): Buffer {
  const buf = Buffer.alloc(PAYLOAD_SIZE);
  for (let i = 0; i < 3; i += 1) {
    buf.writeUInt16LE(settings.adcMinDeadZone[i] ?? 0, 0 + i * 2);
    buf.writeUInt16LE(settings.adcMaxDeadZone[i] ?? 0, 6 + i * 2);
    buf.writeUInt8(settings.adcSmoothing[i] ?? 0, 12 + i);
    buf.writeUInt8(settings.adcToButtonLow[i] ?? 0, 15 + i);
    buf.writeUInt8(settings.adcToButtonHigh[i] ?? 0, 18 + i);
    buf.writeUInt8(settings.adcInvert[i] ?? 0, 21 + i);
  }
  return buf;
}

export function encodeLicense(license: LicenseInfo): Buffer {
  const buf = Buffer.alloc(PAYLOAD_SIZE);
  buf.writeUInt8(license.releaseType, 0);
  buf.writeUInt8(license.major, 1);
  buf.writeUInt8(license.minor, 2);
  buf.writeUInt8(license.patch, 3);
  buf.writeUInt32LE(license.serialKey[0], 4);
  buf.writeUInt32LE(license.serialKey[1], 8);
  buf.writeUInt32LE(license.serialKey[2], 12);
  buf.writeUInt32LE(license.deviceId[0], 16);
  buf.writeUInt32LE(license.deviceId[1], 20);
  buf.writeUInt32LE(license.deviceId[2], 24);
  buf.writeUInt8(license.isRegistered ? 1 : 0, 28);
  return buf;
}

export function encodeState(state: {
  releaseType: number;
  major: number;
  minor: number;
  patch: number;
  isRegistered: boolean;
  position: number;
  torque: number;
}): Buffer {
  const buf = Buffer.alloc(PAYLOAD_SIZE);
  buf.writeUInt8(state.releaseType, 0);
  buf.writeUInt8(state.major, 1);
  buf.writeUInt8(state.minor, 2);
  buf.writeUInt8(state.patch, 3);
  buf.writeUInt8(state.isRegistered ? 1 : 0, 4);
  buf.writeInt16LE(clamp(toInt(state.position), -10000, 10000), 5);
  buf.writeInt16LE(clamp(toInt(state.torque), -10000, 10000), 7);
  return buf;
}

/** Construye todos los bloques a partir de un DeviceSettings (para el mock). */
export function encodeAll(settings: DeviceSettings): Record<"effects" | "hardware" | "gpio" | "adc", Buffer> {
  return {
    effects: encodeEffects(settings.effects),
    hardware: encodeHardware(settings.hardware),
    gpio: encodeGpio(settings.gpio),
    adc: encodeAdc(settings.adc),
  };
}
