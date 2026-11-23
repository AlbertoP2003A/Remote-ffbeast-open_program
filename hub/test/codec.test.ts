import { describe, expect, it } from "vitest";
import {
  decodeAdc,
  decodeEffects,
  decodeGpio,
  decodeHardware,
  decodeLicense,
  decodeState,
  encodeAdc,
  encodeCommand,
  encodeEffects,
  encodeGpio,
  encodeHardware,
  encodeLicense,
  encodeSetting,
  encodeState,
} from "../src/hid/codec.js";
import { readFieldValue } from "../src/hid/fields.js";
import { defaultMockLicense, defaultMockSettings } from "../src/hid/mock.js";
import { checkField, firmwareAtLeast } from "../src/domain/compatibility.js";

const hex = (buf: Buffer, count = 6): string => buf.subarray(0, count).toString("hex");

describe("codec: escritura de ajustes", () => {
  it("MotionRange = 900", () => {
    expect(hex(encodeSetting(5, 0, "u16", 900))).toBe("a31405008403");
  });

  it("PowerLimit = 80", () => {
    expect(hex(encodeSetting(17, 0, "u8", 80), 5)).toBe("a314110050");
  });

  it("ForceDirection = -1", () => {
    expect(hex(encodeSetting(22, 0, "i8", -1), 5)).toBe("a3141600ff");
  });

  it("índice de array (PinMode[3] = 2)", () => {
    const buf = encodeSetting(28, 3, "u8", 2);
    expect(hex(buf, 5)).toBe("a3141c0302");
  });

  it("siempre genera 65 bytes", () => {
    expect(encodeSetting(5, 0, "u16", 900)).toHaveLength(65);
    expect(encodeCommand("save")).toHaveLength(65);
  });
});

describe("codec: comandos", () => {
  it("guardar", () => expect(hex(encodeCommand("save"), 5)).toBe("a302000000"));
  it("reset de centro", () => expect(hex(encodeCommand("reset-center"), 5)).toBe("a304000000"));
  it("reboot", () => expect(hex(encodeCommand("reboot"), 5)).toBe("a301000000"));
  it("dfu", () => expect(hex(encodeCommand("dfu"), 5)).toBe("a303000000"));
});

describe("codec: estado en vivo", () => {
  it("decodifica firmware, posición y torque", () => {
    const payload = Buffer.alloc(64);
    payload.writeUInt8(0, 0);
    payload.writeUInt8(26, 1);
    payload.writeUInt8(1, 2);
    payload.writeUInt8(1, 3);
    payload.writeUInt8(1, 4);
    payload.writeInt16LE(-1234, 5);
    payload.writeInt16LE(500, 7);

    const state = decodeState(payload);
    expect(state.major).toBe(26);
    expect(state.minor).toBe(1);
    expect(state.patch).toBe(1);
    expect(state.isRegistered).toBe(true);
    expect(state.position).toBe(-1234);
    expect(state.torque).toBe(500);
  });

  it("roundtrip de encodeState", () => {
    const payload = encodeState({
      releaseType: 0,
      major: 26,
      minor: 1,
      patch: 1,
      isRegistered: false,
      position: 9999,
      torque: -9999,
    });
    const state = decodeState(payload);
    expect(state.position).toBe(9999);
    expect(state.torque).toBe(-9999);
    expect(state.isRegistered).toBe(false);
  });
});

describe("codec: bloques completos", () => {
  const settings = defaultMockSettings();

  it("effects", () => {
    const payload = encodeEffects(settings.effects);
    expect(decodeEffects(payload)).toEqual(settings.effects);
    expect(readFieldValue(payload, "motionRange")).toBe(900);
    expect(readFieldValue(payload, "directXConstantDirection")).toBe(1);
    expect(readFieldValue(payload, "dynamicDampeningStrength")).toBe(0);
  });

  it("hardware", () => {
    const payload = encodeHardware(settings.hardware);
    expect(decodeHardware(payload)).toEqual(settings.hardware);
    expect(readFieldValue(payload, "encoderCpr")).toBe(4096);
    expect(readFieldValue(payload, "encoderDirection")).toBe(1);
  });

  it("gpio", () => {
    const payload = encodeGpio(settings.gpio);
    expect(decodeGpio(payload)).toEqual(settings.gpio);
    expect(readFieldValue(payload, "extensionMode")).toBe(0);
    expect(readFieldValue(payload, "pinMode", 0)).toBe(0);
    expect(readFieldValue(payload, "pinMode", 9)).toBe(0);
  });

  it("adc", () => {
    const payload = encodeAdc(settings.adc);
    expect(decodeAdc(payload)).toEqual(settings.adc);
    expect(readFieldValue(payload, "adcMaxDeadZone", 2)).toBe(65535);
    expect(readFieldValue(payload, "adcToButtonHigh", 0)).toBe(100);
  });

  it("license", () => {
    const license = defaultMockLicense();
    const payload = encodeLicense(license);
    expect(decodeLicense(payload)).toEqual(license);
  });
});

describe("compatibilidad", () => {
  const free = { ...defaultMockLicense(), isRegistered: false };
  const pro = { ...defaultMockLicense(), isRegistered: true };

  it("motionRange > 1080 exige PRO", () => {
    expect(checkField("motionRange", 1200, free)).not.toBeNull();
    expect(checkField("motionRange", 1200, pro)).toBeNull();
    expect(checkField("motionRange", 900, free)).toBeNull();
  });

  it("muelle integrado exige firmware 24.1.4", () => {
    const old = { ...pro, major: 24, minor: 1, patch: 3 };
    expect(checkField("integratedSpringStrength", 10, old)).not.toBeNull();
    expect(checkField("integratedSpringStrength", 10, pro)).toBeNull();
    expect(firmwareAtLeast(old, 24, 1, 4)).toBe(false);
    expect(firmwareAtLeast(pro, 24, 1, 4)).toBe(true);
  });
});
