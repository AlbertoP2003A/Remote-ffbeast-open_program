export type FieldType = "u8" | "i8" | "u16" | "i16";
export type SettingsGroup = "effects" | "hardware" | "gpio" | "adc" | "misc";
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Metadatos de un ajuste. El hub es la unica fuente de verdad: la UI pinta
 * los formularios a partir de esta tabla, asi que al anadir un campo no hay
 * que tocar el frontend.
 */
export interface FieldDef {
  name: string;
  id: number;
  type: FieldType;
  group: SettingsGroup;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  advanced: boolean;
  /** Si es un array (pines, botones, ejes), longitud del array. */
  arrayLength?: number;
  /** false para campos que no aparecen en ningun feature report (solo escritura). */
  readback: boolean;
  /** El firmware solo aplica el cambio despues de guardar y reiniciar. */
  requiresReboot?: boolean;
  description?: string;
  /** Opciones fijas para selects (p. ej. direccion -1/+1). */
  options?: Array<{ value: number; label: string }>;
}

export interface EffectsSettings {
  motionRange: number;
  staticDampeningStrength: number;
  softStopDampeningStrength: number;
  dynamicDampeningStrength: number;
  totalEffectStrength: number;
  integratedSpringStrength: number;
  softStopRange: number;
  softStopStrength: number;
  directXConstantDirection: number;
  directXSpringStrength: number;
  directXConstantStrength: number;
  directXPeriodicStrength: number;
}

export interface HardwareSettings {
  encoderCpr: number;
  integralGain: number;
  proportionalGain: number;
  forceEnabled: number;
  debugTorque: number;
  amplifierGain: number;
  calibrationMagnitude: number;
  calibrationSpeed: number;
  powerLimit: number;
  brakingLimit: number;
  positionSmoothing: number;
  speedBufferSize: number;
  encoderDirection: number;
  forceDirection: number;
  polePairs: number;
}

export interface GpioSettings {
  extensionMode: number;
  pinMode: number[];
  buttonMode: number[];
  spiMode: number;
  spiLatchMode: number;
  spiLatchDelay: number;
  spiClkPulseLength: number;
}

export interface AdcSettings {
  adcMinDeadZone: number[];
  adcMaxDeadZone: number[];
  adcSmoothing: number[];
  adcToButtonLow: number[];
  adcToButtonHigh: number[];
  adcInvert: number[];
}

export interface DeviceSettings {
  effects: EffectsSettings;
  hardware: HardwareSettings;
  gpio: GpioSettings;
  adc: AdcSettings;
}

export interface LicenseInfo {
  releaseType: number;
  major: number;
  minor: number;
  patch: number;
  serialKey: [number, number, number];
  deviceId: [number, number, number];
  isRegistered: boolean;
}

/** Ejes estándar de la interfaz joystick (HID, report id 0x01). */
export interface JoystickAxes {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  slider: number;
  dial: number;
  /** Números de botón pulsados (1..64). */
  buttons: number[];
  timestamp: number;
}

export interface LiveState {
  releaseType: number;
  major: number;
  minor: number;
  patch: number;
  isRegistered: boolean;
  /** -10000..10000, normalizado. */
  position: number;
  /** -10000..10000, normalizado. */
  torque: number;
  positionDegrees: number;
  positionPercent: number;
  positionNormalized: number;
  torqueNormalized: number;
  torquePercent: number;
  timestamp: number;
  /** Ejes del joystick (pedales, embrague, etc.), si están disponibles. */
  axes?: JoystickAxes | null;
}

export interface HubStatus {
  connected: boolean;
  mock: boolean;
  firmware: string | null;
  license: LicenseInfo | null;
  readOnly: boolean;
  port: number;
  version: string;
  path: string | null;
  position: number | null;
  torque: number | null;
}

export interface Profile {
  id: string;
  name: string;
  createdAt: string;
  deviceSettings: DeviceSettings;
}

export interface ProfilesFile {
  version: 1;
  profiles: Profile[];
}

export interface AppConfig {
  version: 1;
  port: number;
  token: string;
  readOnly: boolean;
  allowSaveCommand: boolean;
  allowRebootCommand: boolean;
  allowDfuCommand: boolean;
  stateHz: number;
  logLevel: LogLevel;
  mock: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
