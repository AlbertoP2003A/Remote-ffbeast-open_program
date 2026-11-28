/**
 * Muestra la version de forma corta: 1.2.0 -> "1.2", 1.2.1 -> "1.2.1".
 * La version interna (paquete, .exe) sigue siendo 1.2.0.
 */
export function displayVersion(
  version: string | null | undefined,
  fallback = "1.2",
): string {
  if (!version) return fallback;
  return version.replace(/\.0$/, "");
}
