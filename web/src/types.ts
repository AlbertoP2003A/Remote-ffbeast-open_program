export type FieldType = "u8" | "i8" | "u16" | "i16";
export type SettingsGroup = "effects" | "hardware" | "gpio" | "adc" | "misc";

export interface FieldOption {
  value: number;
  label: string;
}

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
  arrayLength?: number;
  readback: boolean;
  requiresReboot?: boolean;
  description?: string;
  options?: FieldOption[];
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

export interface JoystickAxes {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  slider: number;
  dial: number;
  buttons: number[];
  timestamp: number;
}

export interface LiveState {
  releaseType: number;
  major: number;
  minor: number;
  patch: number;
  isRegistered: boolean;
  position: number;
  torque: number;
  positionDegrees: number;
  positionPercent: number;
  positionNormalized: number;
  torqueNormalized: number;
  torquePercent: number;
  timestamp: number;
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

export interface PublicConfig {
  port: number;
  readOnly: boolean;
  allowSaveCommand: boolean;
  allowRebootCommand: boolean;
  allowDfuCommand: boolean;
  stateHz: number;
  mock: boolean;
}

export interface SessionInfo {
  authenticated: boolean;
  loopback: boolean;
  readOnly: boolean;
}

export interface LanAddress {
  address: string;
  iface: string;
  score: number;
}

export interface Diagnostics {
  version: string;
  api: number;
  uptimeSeconds: number;
  port: number;
  readOnly: boolean;
  mock: boolean;
  connected: boolean;
  firmware: string | null;
  license: LicenseInfo | null;
  lan: LanAddress[];
  dataDir: string;
  configPath: string;
  hid: Array<{ path: string; product?: string; vendorId: number; productId: number }>;
}
