/**
 * Muestra la version de forma corta: 1.0.0 -> "1.0", 1.0.1 -> "1.0.1".
 * La version interna (paquete, .exe) sigue siendo 1.0.0.
 */
export function displayVersion(
  version: string | null | undefined,
  fallback = "1.0",
): string {
  if (!version) return fallback;
  return version.replace(/\.0$/, "");
}
