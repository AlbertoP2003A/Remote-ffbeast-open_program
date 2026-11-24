import React from "react";
import { useHub } from "../hub";
import { Banner } from "./ui";

/** A partir de este porcentaje avisamos, pero no bloqueamos el cambio. */
const HIGH_LIMIT = 80;

/**
 * Aviso no bloqueante para ajustes que pueden generar mucha fuerza.
 * El usuario puede seguir configurando; solo le pedimos que lo haga con
 * cuidado y con valores bajos al principio.
 */
export function SafetyNotice(): React.ReactElement | null {
  const { settings } = useHub();
  if (!settings) return null;

  const warnings: string[] = [];
  if (settings.hardware.powerLimit > HIGH_LIMIT) {
    warnings.push(`potencia ${settings.hardware.powerLimit}%`);
  }
  if (settings.hardware.brakingLimit > HIGH_LIMIT) {
    warnings.push(`frenado ${settings.hardware.brakingLimit}%`);
  }
  if (settings.effects.totalEffectStrength > HIGH_LIMIT) {
    warnings.push(`efectos ${settings.effects.totalEffectStrength}%`);
  }
  if (settings.hardware.debugTorque !== 0) {
    warnings.push("torque de depuración activo");
  }

  if (warnings.length === 0) return null;

  return (
    <Banner tone="warn" icon="alert" title="Ajustes de fuerza altos">
      {warnings.join(" · ")}. Prueba primero con valores bajos, con el volante
      sujeto y las manos fuera del radio de giro.
    </Banner>
  );
}
