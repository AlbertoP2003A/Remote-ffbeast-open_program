import type { DeviceSettings, FieldDef } from "./types.js";

const dir = [
  { value: -1, label: "Invertida (-1)" },
  { value: 1, label: "Normal (+1)" },
];

/**
 * Registro de ajustes. Los IDs y tipos salen de SettingsFieldEnum en
 * wheel_api.h y en la documentacion oficial. DynamicDampening (ID 10) si
 * existe en el firmware 26.1.1: va en el struct de Effects en el offset 14.
 */
export const FIELDS: FieldDef[] = [
  // ---------------------------------------------------------------- Effects
  {
    name: "motionRange",
    id: 5,
    type: "u16",
    group: "effects",
    label: "Recorrido de giro",
    unit: "°",
    min: 90,
    max: 2160,
    step: 10,
    advanced: false,
    readback: true,
    description: "Grados totales de giro. Por encima de 1080 requiere licencia PRO.",
  },
  {
    name: "totalEffectStrength",
    id: 4,
    type: "u8",
    group: "effects",
    label: "Fuerza total de efectos",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "staticDampeningStrength",
    id: 8,
    type: "u16",
    group: "effects",
    label: "Amortiguación estática",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "softStopStrength",
    id: 6,
    type: "u8",
    group: "effects",
    label: "Fuerza del tope suave",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "softStopRange",
    id: 7,
    type: "u8",
    group: "effects",
    label: "Rango del tope suave",
    unit: "°",
    min: 0,
    max: 180,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "softStopDampeningStrength",
    id: 9,
    type: "u16",
    group: "effects",
    label: "Amortiguación del tope suave",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "dynamicDampeningStrength",
    id: 10,
    type: "u16",
    group: "effects",
    label: "Amortiguación dinámica",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
    description: "Requiere firmware 24.1.5 o superior y licencia PRO.",
  },
  {
    name: "integratedSpringStrength",
    id: 43,
    type: "u8",
    group: "effects",
    label: "Muelle integrado",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: false,
    readback: true,
    description: "Requiere firmware 24.1.4 o superior.",
  },
  {
    name: "directXSpringStrength",
    id: 1,
    type: "u8",
    group: "effects",
    label: "Muelle DirectX",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "directXConstantStrength",
    id: 2,
    type: "u8",
    group: "effects",
    label: "Fuerza constante DirectX",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "directXPeriodicStrength",
    id: 3,
    type: "u8",
    group: "effects",
    label: "Fuerza periódica DirectX",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "directXConstantDirection",
    id: 0,
    type: "i8",
    group: "effects",
    label: "Dirección de la fuerza constante",
    min: -1,
    max: 1,
    step: 2,
    advanced: true,
    readback: true,
    options: dir,
  },

  // --------------------------------------------------------------- Hardware
  {
    name: "forceEnabled",
    id: 11,
    type: "u8",
    group: "hardware",
    label: "Fuerza activada",
    min: 0,
    max: 1,
    step: 1,
    advanced: false,
    readback: true,
    requiresReboot: true,
    description: "Requiere guardar y reiniciar el volante para aplicarse.",
  },
  {
    name: "encoderCpr",
    id: 24,
    type: "u16",
    group: "hardware",
    label: "Encoder CPR",
    min: 1,
    max: 65535,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "proportionalGain",
    id: 25,
    type: "u8",
    group: "hardware",
    label: "Ganancia proporcional (P)",
    min: 0,
    max: 255,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "integralGain",
    id: 26,
    type: "u16",
    group: "hardware",
    label: "Ganancia integral (I)",
    min: 0,
    max: 65535,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "polePairs",
    id: 23,
    type: "u8",
    group: "hardware",
    label: "Pares de polos",
    min: 1,
    max: 64,
    step: 1,
    advanced: false,
    readback: true,
  },
  {
    name: "encoderDirection",
    id: 21,
    type: "i8",
    group: "hardware",
    label: "Dirección del encoder",
    min: -1,
    max: 1,
    step: 2,
    advanced: true,
    readback: true,
    options: dir,
  },
  {
    name: "forceDirection",
    id: 22,
    type: "i8",
    group: "hardware",
    label: "Dirección de la fuerza",
    min: -1,
    max: 1,
    step: 2,
    advanced: true,
    readback: true,
    options: dir,
  },
  {
    name: "powerLimit",
    id: 17,
    type: "u8",
    group: "hardware",
    label: "Límite de potencia",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
  },
  {
    name: "brakingLimit",
    id: 18,
    type: "u8",
    group: "hardware",
    label: "Límite de frenado",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
  },
  {
    name: "positionSmoothing",
    id: 19,
    type: "u8",
    group: "hardware",
    label: "Suavizado de posición",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
  },
  {
    name: "speedBufferSize",
    id: 20,
    type: "u8",
    group: "hardware",
    label: "Búfer de velocidad",
    min: 1,
    max: 255,
    step: 1,
    advanced: true,
    readback: true,
  },
  {
    name: "amplifierGain",
    id: 13,
    type: "u8",
    group: "hardware",
    label: "Ganancia del amplificador",
    min: 0,
    max: 3,
    step: 1,
    advanced: true,
    readback: true,
    requiresReboot: true,
    description: "Ganancia de sensado de corriente; requiere guardar y reiniciar.",
    options: [
      { value: 0, label: "80" },
      { value: 1, label: "40" },
      { value: 2, label: "20" },
      { value: 3, label: "10" },
    ],
  },
  {
    name: "calibrationMagnitude",
    id: 15,
    type: "u8",
    group: "hardware",
    label: "Magnitud de calibración",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
  },
  {
    name: "calibrationSpeed",
    id: 16,
    type: "u8",
    group: "hardware",
    label: "Velocidad de calibración",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
  },
  {
    name: "debugTorque",
    id: 12,
    type: "u8",
    group: "hardware",
    label: "Torque de depuración",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
  },

  // ------------------------------------------------------------------- GPIO
  {
    name: "extensionMode",
    id: 27,
    type: "u8",
    group: "gpio",
    label: "Modo de extensión",
    min: 0,
    max: 1,
    step: 1,
    advanced: true,
    readback: true,
    requiresReboot: true,
    options: [
      { value: 0, label: "Ninguno" },
      { value: 1, label: "Personalizado" },
    ],
  },
  {
    name: "pinMode",
    id: 28,
    type: "u8",
    group: "gpio",
    label: "Modo de pin",
    min: 0,
    max: 10,
    step: 1,
    advanced: true,
    readback: true,
    requiresReboot: true,
    arrayLength: 10,
    options: [
      { value: 0, label: "Ninguno" },
      { value: 1, label: "GPIO" },
      { value: 2, label: "Analógico" },
      { value: 3, label: "SPI CS" },
      { value: 4, label: "SPI SCK" },
      { value: 5, label: "SPI MISO" },
      { value: 6, label: "Habilitar efectos" },
      { value: 7, label: "Reset de centro" },
      { value: 8, label: "Freno PWM" },
      { value: 9, label: "LED de efecto" },
      { value: 10, label: "Reiniciar" },
    ],
  },
  {
    name: "buttonMode",
    id: 29,
    type: "u8",
    group: "gpio",
    label: "Modo de botón",
    min: 0,
    max: 4,
    step: 1,
    advanced: true,
    readback: true,
    requiresReboot: true,
    arrayLength: 32,
    options: [
      { value: 0, label: "Ninguno" },
      { value: 1, label: "Normal" },
      { value: 2, label: "Invertido" },
      { value: 3, label: "Pulso" },
      { value: 4, label: "Pulso invertido" },
    ],
  },
  {
    name: "spiMode",
    id: 30,
    type: "u8",
    group: "gpio",
    label: "Modo SPI",
    min: 0,
    max: 3,
    step: 1,
    advanced: true,
    readback: true,
    requiresReboot: true,
    options: [
      { value: 0, label: "Modo 0" },
      { value: 1, label: "Modo 1" },
      { value: 2, label: "Modo 2" },
      { value: 3, label: "Modo 3" },
    ],
  },
  {
    name: "spiLatchMode",
    id: 31,
    type: "u8",
    group: "gpio",
    label: "Modo de latch SPI",
    min: 0,
    max: 1,
    step: 1,
    advanced: true,
    readback: true,
    requiresReboot: true,
    options: [
      { value: 0, label: "nCS arriba" },
      { value: 1, label: "nCS abajo" },
    ],
  },
  {
    name: "spiLatchDelay",
    id: 32,
    type: "u8",
    group: "gpio",
    label: "Retardo de latch SPI",
    unit: "µs",
    min: 0,
    max: 255,
    step: 1,
    advanced: true,
    readback: true,
    requiresReboot: true,
  },
  {
    name: "spiClkPulseLength",
    id: 33,
    type: "u8",
    group: "gpio",
    label: "Duración del pulso de reloj SPI",
    unit: "µs",
    min: 0,
    max: 255,
    step: 1,
    advanced: true,
    readback: true,
    requiresReboot: true,
  },

  // -------------------------------------------------------------------- ADC
  {
    name: "adcMinDeadZone",
    id: 34,
    type: "u16",
    group: "adc",
    label: "Zona muerta mínima",
    min: 0,
    max: 65535,
    step: 1,
    advanced: true,
    readback: true,
    arrayLength: 3,
  },
  {
    name: "adcMaxDeadZone",
    id: 35,
    type: "u16",
    group: "adc",
    label: "Zona muerta máxima",
    min: 0,
    max: 65535,
    step: 1,
    advanced: true,
    readback: true,
    arrayLength: 3,
  },
  {
    name: "adcToButtonLow",
    id: 36,
    type: "u8",
    group: "adc",
    label: "Umbral bajo de botón",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
    arrayLength: 3,
  },
  {
    name: "adcToButtonHigh",
    id: 37,
    type: "u8",
    group: "adc",
    label: "Umbral alto de botón",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
    arrayLength: 3,
  },
  {
    name: "adcSmoothing",
    id: 38,
    type: "u8",
    group: "adc",
    label: "Suavizado del eje",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
    advanced: true,
    readback: true,
    arrayLength: 3,
  },
  {
    name: "adcInvert",
    id: 39,
    type: "u8",
    group: "adc",
    label: "Invertir eje",
    min: 0,
    max: 1,
    step: 1,
    advanced: true,
    readback: true,
    arrayLength: 3,
  },

  // ------------------------------------------------------------------- Misc
  {
    name: "resetCenterOnZ0",
    id: 41,
    type: "u8",
    group: "misc",
    label: "Centrar al pulsar Z0",
    min: 0,
    max: 1,
    step: 1,
    advanced: true,
    readback: false,
    requiresReboot: true,
    description: "Solo escritura: no aparece en ningún reporte de lectura.",
  },
];

const byName = new Map(FIELDS.map((f) => [f.name, f]));
const byId = new Map(FIELDS.map((f) => [f.id, f]));

export function fieldByName(name: string): FieldDef | undefined {
  return byName.get(name);
}

export function fieldById(id: number): FieldDef | undefined {
  return byId.get(id);
}

/** Resuelve por nombre o por ID numerico (compatibilidad con la API del plan). */
export function resolveField(ref: string | number): FieldDef | undefined {
  return typeof ref === "number" ? fieldById(ref) : fieldByName(ref);
}

export function fieldsForGroup(group: string): FieldDef[] {
  return FIELDS.filter((f) => f.group === group);
}

export function readFieldValue(
  payload: Buffer,
  name: string,
  index = 0,
): number | undefined {
  switch (name) {
    // Effects (payload de 0x22)
    case "motionRange":
      return payload.readUInt16LE(0);
    case "staticDampeningStrength":
      return payload.readUInt16LE(2);
    case "softStopDampeningStrength":
      return payload.readUInt16LE(4);
    case "dynamicDampeningStrength":
      return payload.readUInt16LE(14);
    case "totalEffectStrength":
      return payload.readUInt8(6);
    case "integratedSpringStrength":
      return payload.readUInt8(7);
    case "softStopRange":
      return payload.readUInt8(8);
    case "softStopStrength":
      return payload.readUInt8(9);
    case "directXConstantDirection":
      return payload.readInt8(10);
    case "directXSpringStrength":
      return payload.readUInt8(11);
    case "directXConstantStrength":
      return payload.readUInt8(12);
    case "directXPeriodicStrength":
      return payload.readUInt8(13);

    // Hardware (payload de 0x21)
    case "encoderCpr":
      return payload.readUInt16LE(0);
    case "integralGain":
      return payload.readUInt16LE(2);
    case "proportionalGain":
      return payload.readUInt8(4);
    case "forceEnabled":
      return payload.readUInt8(5);
    case "debugTorque":
      return payload.readUInt8(6);
    case "amplifierGain":
      return payload.readUInt8(7);
    case "calibrationMagnitude":
      return payload.readUInt8(8);
    case "calibrationSpeed":
      return payload.readUInt8(9);
    case "powerLimit":
      return payload.readUInt8(10);
    case "brakingLimit":
      return payload.readUInt8(11);
    case "positionSmoothing":
      return payload.readUInt8(12);
    case "speedBufferSize":
      return payload.readUInt8(13);
    case "encoderDirection":
      return payload.readInt8(14);
    case "forceDirection":
      return payload.readInt8(15);
    case "polePairs":
      return payload.readUInt8(16);

    // GPIO (payload de 0xA1)
    case "extensionMode":
      return payload.readUInt8(0);
    case "pinMode":
      return payload.readUInt8(1 + index);
    case "buttonMode":
      return payload.readUInt8(11 + index);
    case "spiMode":
      return payload.readUInt8(43);
    case "spiLatchMode":
      return payload.readUInt8(44);
    case "spiLatchDelay":
      return payload.readUInt8(45);
    case "spiClkPulseLength":
      return payload.readUInt8(46);

    // ADC (payload de 0xA2)
    case "adcMinDeadZone":
      return payload.readUInt16LE(0 + index * 2);
    case "adcMaxDeadZone":
      return payload.readUInt16LE(6 + index * 2);
    case "adcSmoothing":
      return payload.readUInt8(12 + index);
    case "adcToButtonLow":
      return payload.readUInt8(15 + index);
    case "adcToButtonHigh":
      return payload.readUInt8(18 + index);
    case "adcInvert":
      return payload.readUInt8(21 + index);

    default:
      return undefined;
  }
}

/** Extrae el valor actual de un campo desde el objeto de ajustes. */
export function valueFromSettings(
  settings: DeviceSettings,
  name: string,
  index = 0,
): number | undefined {
  const group = FIELDS.find((f) => f.name === name)?.group;
  if (!group) return undefined;
  if (group === "misc") return undefined;
  const bag = settings[group] as unknown as Record<string, number | number[]>;
  const value = bag[name];
  if (Array.isArray(value)) return value[index];
  return value;
}

/** Escribe un valor dentro del objeto de ajustes (inmutable por fuera). */
export function withValue(
  settings: DeviceSettings,
  name: string,
  value: number,
  index = 0,
): DeviceSettings {
  const def = fieldByName(name);
  if (!def || def.group === "misc") return settings;
  const group = def.group as "effects" | "hardware" | "gpio" | "adc";
  const bag = settings[group] as unknown as Record<string, number | number[]>;
  const next = { ...bag };
  const current = next[name];
  if (Array.isArray(current)) {
    const arr = [...current];
    arr[index] = value;
    next[name] = arr;
  } else {
    next[name] = value;
  }
  return { ...settings, [group]: next } as DeviceSettings;
}
