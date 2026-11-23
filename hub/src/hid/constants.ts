/**
 * Identificacion USB y numeros de reporte del volante FFBeast.
 * Fuente: ffbeast-wheel-api-lib/wheel_api.h (RC 26.1.1).
 */
export const USB_VID = 0x045b; // 1115
export const USB_PID = 0x59d7; // 22999
export const VENDOR_INTERFACE = 0;
export const USAGE_PAGE = 0xff72;

/** Tamano del reporte en el cable: 1 byte de report id + 64 de payload. */
export const REPORT_SIZE = 65;
export const PAYLOAD_SIZE = 64;

export const REPORT_ID = {
  joystick: 0x01,
  hardware: 0x21,
  effects: 0x22,
  license: 0x25,
  gpio: 0xa1,
  adc: 0xa2,
  generic: 0xa3,
} as const;

export const DATA_TYPE = {
  reboot: 0x01,
  save: 0x02,
  dfu: 0x03,
  resetCenter: 0x04,
  directControl: 0x10,
  activation: 0x13,
  settingsField: 0x14,
} as const;

export type FeatureBlock = "hardware" | "effects" | "license" | "gpio" | "adc";

export const FEATURE_REPORT: Record<FeatureBlock, number> = {
  hardware: REPORT_ID.hardware,
  effects: REPORT_ID.effects,
  license: REPORT_ID.license,
  gpio: REPORT_ID.gpio,
  adc: REPORT_ID.adc,
};
