import type { LicenseInfo } from "../hid/types.js";

export function firmwareString(license: LicenseInfo | null): string | null {
  if (!license) return null;
  return `${license.major}.${license.minor}.${license.patch}`;
}

export function firmwareAtLeast(
  license: LicenseInfo | null,
  major: number,
  minor: number,
  patch: number,
): boolean {
  if (!license) return true; // Sin datos no bloqueamos: el read-back decide.
  const value = license.major * 10000 + license.minor * 100 + license.patch;
  return value >= major * 10000 + minor * 100 + patch;
}

export function isPro(license: LicenseInfo | null): boolean {
  return Boolean(license?.isRegistered);
}

/**
 * Reglas conocidas de compatibilidad. Devuelve un mensaje si el campo no
 * deberia escribirse con ese valor; null si es aceptable.
 */
export function checkField(
  name: string,
  value: number,
  license: LicenseInfo | null,
): string | null {
  if (name === "motionRange" && value > 1080 && !isPro(license)) {
    return "Un recorrido superior a 1080° requiere licencia PRO.";
  }
  if (
    name === "integratedSpringStrength" &&
    value > 0 &&
    !firmwareAtLeast(license, 24, 1, 4)
  ) {
    return "El muelle integrado requiere firmware 24.1.4 o superior.";
  }
  if (name === "dynamicDampeningStrength" && value > 0) {
    if (!isPro(license) || !firmwareAtLeast(license, 24, 1, 5)) {
      return "La amortiguación dinámica requiere firmware 24.1.5 o superior y licencia PRO.";
    }
  }
  return null;
}
