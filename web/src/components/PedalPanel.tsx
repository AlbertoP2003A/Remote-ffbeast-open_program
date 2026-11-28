import React, { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../api";
import { useHub } from "../hub";
import type { AdcSettings, JoystickAxes } from "../types";
import { Banner, Button } from "./ui";

const PEDALS = [
  { key: "rx", label: "Pedal 1", hid: "Rx", index: 0 },
  { key: "ry", label: "Pedal 2", hid: "Ry", index: 1 },
  { key: "rz", label: "Pedal 3", hid: "Rz", index: 2 },
] as const;

type PedalKey = (typeof PEDALS)[number]["key"];

/**
 * Porcentaje 0..100 para valores no negativos (compatibilidad con la página
 * Ejes). Los pedales usan `signedPercent` para mostrar el eje HID completo,
 * que va de -32767 a +32767.
 */
export function pedalPercent(value: number): number {
  return Math.max(0, Math.min(100, (value / 32767) * 100));
}

function signedPercent(value: number): number {
  return Math.max(0, Math.min(100, ((value + 32767) / 65534) * 100));
}

const HID_MAX = 32767;
const TEST_ADC_MAX = 8191;
const MIN_TRAVEL = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneAdc(adc: AdcSettings): AdcSettings {
  return {
    adcMinDeadZone: [...adc.adcMinDeadZone],
    adcMaxDeadZone: [...adc.adcMaxDeadZone],
    adcSmoothing: [...adc.adcSmoothing],
    adcToButtonLow: [...adc.adcToButtonLow],
    adcToButtonHigh: [...adc.adcToButtonHigh],
    adcInvert: [...adc.adcInvert],
  };
}

function withAxis(
  adc: AdcSettings,
  index: number,
  patch: { min?: number; max?: number; invert?: number },
): AdcSettings {
  const next = cloneAdc(adc);
  if (patch.min !== undefined) next.adcMinDeadZone[index] = patch.min;
  if (patch.max !== undefined) next.adcMaxDeadZone[index] = patch.max;
  if (patch.invert !== undefined) next.adcInvert[index] = patch.invert;
  return next;
}

/** Convierte el eje HID (-32767..32767) a cuentas de ADC del rango de prueba. */
function axisToAdc(value: number): number {
  const clamped = clamp(value, -HID_MAX, HID_MAX);
  return clamp(((clamped + HID_MAX) / (HID_MAX * 2)) * TEST_ADC_MAX, 0, TEST_ADC_MAX);
}

function captureAxis(
  axesRef: React.MutableRefObject<JoystickAxes | null | undefined>,
  key: PedalKey,
  tolerance: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const values: number[] = [];
    const started = Date.now();
    const timer = window.setInterval(() => {
      const value = axesRef.current?.[key];
      if (typeof value === "number") values.push(value);
      if (Date.now() - started < 900) return;
      window.clearInterval(timer);
      if (values.length < 5) {
        reject(new Error("No hay datos del joystick. Revisa la conexión del volante."));
        return;
      }
      const sorted = [...values].sort((a, b) => a - b);
      const spread = sorted[sorted.length - 1] - sorted[0];
      if (spread > tolerance) {
        reject(
          new Error(
            "El pedal no se mantuvo quieto. Mantén la posición y vuelve a intentarlo.",
          ),
        );
        return;
      }
      resolve(sorted[Math.floor(sorted.length / 2)]);
    }, 40);
  });
}

function AxisBar({
  label,
  hid,
  value,
  compact = false,
  signed = false,
}: {
  label: string;
  hid?: string;
  value: number;
  compact?: boolean;
  signed?: boolean;
}): React.ReactElement {
  const pct = signed ? signedPercent(value) : pedalPercent(value);
  return (
    <div className={`pedal-row${compact ? " is-compact" : ""}`}>
      <span className="pedal-name">
        {label}
        {hid && <em>{hid}</em>}
      </span>
      <div className="pedal-track">
        <span className="pedal-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="pedal-value">{pct.toFixed(0)}%</span>
      <span className="pedal-raw">{value}</span>
    </div>
  );
}

type WizardStep = "rest" | "full" | "result";

interface WizardState {
  pedalIndex: number;
  step: WizardStep;
  rest: number | null;
  full: number | null;
  result: { min: number; max: number; invert: number } | null;
}

export function PedalPanel({
  axes,
}: {
  axes: JoystickAxes | null | undefined;
}): React.ReactElement {
  const { settings, writable, config, applySettings, runCommand, notify } = useHub();
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const axesRef = useRef<JoystickAxes | null | undefined>(axes);
  const adcRef = useRef<AdcSettings | null>(null);
  const backupRef = useRef<AdcSettings | null>(null);

  useEffect(() => {
    axesRef.current = axes;
  }, [axes]);

  // La calibración visual antigua se guardaba en localStorage. Ahora manda la
  // del firmware, así que se elimina para que no se aplique dos veces.
  useEffect(() => {
    try {
      localStorage.removeItem("ffbeast.pedalCalibration");
    } catch {
      // modo privado: no hay nada que borrar
    }
  }, []);

  useEffect(() => {
    if (!wizard && settings) adcRef.current = cloneAdc(settings.adc);
  }, [settings, wizard]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const openWizard = (): void => {
    if (!settings) return;
    const backup = cloneAdc(settings.adc);
    backupRef.current = backup;
    adcRef.current = cloneAdc(backup);
    setMessage(null);
    setWizard({ pedalIndex: 0, step: "rest", rest: null, full: null, result: null });
  };

  const applyTest = useCallback(
    async (index: number): Promise<void> => {
      if (!adcRef.current) throw new Error("Ajustes del volante no disponibles.");
      const next = withAxis(adcRef.current, index, {
        min: 0,
        max: TEST_ADC_MAX,
        invert: 0,
      });
      await applySettings({ adc: next }, { silent: true });
      adcRef.current = next;
    },
    [applySettings],
  );

  const captureRest = async (): Promise<void> => {
    if (!wizard) return;
    setBusy(true);
    setMessage("Preparando la medición…");
    try {
      await applyTest(wizard.pedalIndex);
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      const raw = axisToAdc(
        await captureAxis(axesRef, PEDALS[wizard.pedalIndex].key, 1200),
      );
      setWizard((current) =>
        current ? { ...current, step: "full", rest: raw } : current,
      );
      setMessage(`Reposo capturado: ${Math.round(raw)} cuentas. Ahora pisa a fondo.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const captureFull = async (): Promise<void> => {
    if (!wizard || wizard.rest === null || !adcRef.current) return;
    setBusy(true);
    setMessage("Midiendo el fondo…");
    try {
      const raw = axisToAdc(
        await captureAxis(axesRef, PEDALS[wizard.pedalIndex].key, 2000),
      );
      const rest = Math.round(wizard.rest);
      const full = Math.round(raw);
      const travel = Math.abs(full - rest);
      if (travel < MIN_TRAVEL) {
        throw new Error(
          `Recorrido insuficiente (${travel} cuentas). Revisa el pedal y vuelve a intentarlo.`,
        );
      }

      const low = Math.min(rest, full);
      const high = Math.max(rest, full);
      const invert = rest > full ? 1 : 0;
      // Deja un 2 % de margen en el extremo de fondo para que el 100 % se
      // alcance aunque no se pise hasta el último count.
      const margin = Math.max(8, Math.round(travel * 0.02));
      let min = low;
      let max = high;
      if (invert) {
        min = Math.min(high - 1, low + margin);
      } else {
        max = Math.max(low + 1, high - margin);
      }

      const next = withAxis(adcRef.current, wizard.pedalIndex, { min, max, invert });
      await applySettings({ adc: next }, { silent: true });
      adcRef.current = next;
      setWizard((current) =>
        current
          ? { ...current, step: "result", full, result: { min, max, invert } }
          : current,
      );
      setDirty(true);
      setMessage("Calibración aplicada. Comprueba que el pedal llega a 0 % y 100 %.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const repeatPedal = (): void => {
    setMessage(null);
    setWizard((current) =>
      current
        ? { ...current, step: "rest", rest: null, full: null, result: null }
        : current,
    );
  };

  const nextPedal = (): void => {
    if (!wizard) return;
    setMessage(null);
    setWizard({
      pedalIndex: Math.min(wizard.pedalIndex + 1, PEDALS.length - 1),
      step: "rest",
      rest: null,
      full: null,
      result: null,
    });
  };

  const save = async (): Promise<void> => {
    if (!config?.allowSaveCommand) {
      setMessage("El comando «Guardar» está desactivado en el hub.");
      return;
    }
    setBusy(true);
    setMessage("Guardando y reiniciando el volante…");
    try {
      await runCommand("save");
      setDirty(false);
      setWizard(null);
      adcRef.current = null;
      backupRef.current = null;
      setMessage(null);
      notify("Calibración guardada en el volante.", "success");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      if (backupRef.current) {
        await applySettings({ adc: backupRef.current }, { silent: true });
        adcRef.current = cloneAdc(backupRef.current);
      }
      backupRef.current = null;
      setWizard(null);
      setDirty(false);
      setMessage(null);
      notify("Calibración anterior restaurada.", "info");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!axes) {
    return (
      <p className="muted">
        El volante no está enviando la interfaz de joystick. Reconéctalo o revisa
        que no esté en modo DFU.
      </p>
    );
  }

  const canCalibrate = Boolean(settings && writable);
  const current = (index: number): { min: number; max: number; invert: number } => {
    const adc = settings?.adc;
    return {
      min: adc?.adcMinDeadZone[index] ?? 0,
      max: adc?.adcMaxDeadZone[index] ?? TEST_ADC_MAX,
      invert: adc?.adcInvert[index] ?? 0,
    };
  };

  const selected = wizard ? PEDALS[wizard.pedalIndex] : null;
  const stepNumber = wizard?.step === "rest" ? 1 : wizard?.step === "full" ? 2 : 3;

  return (
    <div className="pedal-panel">
      <div className="pedal-grid">
        {PEDALS.map((pedal) => (
          <AxisBar
            key={pedal.key}
            label={pedal.label}
            hid={pedal.hid}
            value={axes[pedal.key]}
            signed
          />
        ))}
      </div>

      <div className="pedal-calibration">
        <div className="calibration-head">
          <span>Calibración real en el volante</span>
          <em>valores del firmware</em>
        </div>

        <p className="muted">
          La calibración se escribe en el firmware del volante y la ven Windows y
          los juegos. Al terminar, guarda para que persista al reiniciar.
        </p>

        <div className="calibration-grid">
          {PEDALS.map((pedal) => {
            const value = current(pedal.index);
            return (
              <div key={pedal.key} className="calibration-row">
                <span className="calibration-name">
                  {pedal.label}
                  <em>{pedal.hid}</em>
                </span>
                <span className="calibration-state">
                  mín {value.min} · máx {value.max} ·{" "}
                  {value.invert ? "invertido" : "normal"}
                </span>
              </div>
            );
          })}
        </div>

        {dirty && (
          <Banner tone="warn" icon="alert" title="Cambios sin guardar">
            La calibración está aplicada, pero se pierde al reiniciar el volante.
            Usa «Guardar en el volante».
          </Banner>
        )}

        {!wizard ? (
          <div className="wizard-actions">
            <Button
              size="sm"
              variant="primary"
              onClick={openWizard}
              disabled={!canCalibrate || busy}
            >
              Calibrar pedales
            </Button>
            {dirty && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => void save()}
                disabled={!config?.allowSaveCommand || busy}
              >
                Guardar en el volante
              </Button>
            )}
          </div>
        ) : (
          <div className="pedal-wizard">
            <div className="wizard-head">
              <span className="wizard-step">Paso {stepNumber} de 3</span>
              <strong>
                {selected?.label} · {selected?.hid}
              </strong>
            </div>

            {selected && (
              <AxisBar
                label={selected.label}
                hid={selected.hid}
                value={axes[selected.key]}
                signed
              />
            )}

            {wizard.step === "rest" && (
              <>
                <p className="muted">
                  Suelta el pedal y pulsa «Capturar reposo». Mantenlo quieto durante
                  la medición. Al capturar, la barra puede moverse al centro: es
                  normal, se está midiendo el recorrido completo.
                </p>
                <div className="wizard-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void captureRest()}
                    disabled={busy}
                  >
                    {busy ? "Midiendo…" : "Capturar reposo"}
                  </Button>
                  {wizard.pedalIndex < PEDALS.length - 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={nextPedal}
                      disabled={busy}
                    >
                      Saltar pedal
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void cancel()}
                    disabled={busy}
                  >
                    Cancelar y restaurar
                  </Button>
                </div>
              </>
            )}

            {wizard.step === "full" && (
              <>
                <p className="muted">
                  Pisa a fondo y mantén el pedal. Pulsa «Capturar fondo».
                  {wizard.rest !== null && (
                    <>
                      {" "}
                      Reposo medido: <strong>{Math.round(wizard.rest)}</strong>{" "}
                      cuentas.
                    </>
                  )}
                </p>
                <div className="wizard-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void captureFull()}
                    disabled={busy}
                  >
                    {busy ? "Midiendo…" : "Capturar fondo"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={repeatPedal}
                    disabled={busy}
                  >
                    Repetir reposo
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void cancel()}
                    disabled={busy}
                  >
                    Cancelar y restaurar
                  </Button>
                </div>
              </>
            )}

            {wizard.step === "result" && wizard.result && (
              <>
                <p>
                  Calibrado: mín <strong>{wizard.result.min}</strong>, máx{" "}
                  <strong>{wizard.result.max}</strong>,{" "}
                  {wizard.result.invert ? "invertido" : "normal"}.
                </p>
                <p className="muted">
                  Comprueba que el pedal va de 0 % a 100 %. Si no llega, repite la
                  captura o baja el mínimo a mano desde Ejes.
                </p>
                <div className="wizard-actions">
                  {wizard.pedalIndex < PEDALS.length - 1 && (
                    <Button size="sm" variant="primary" onClick={nextPedal}>
                      Siguiente pedal
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void save()}
                    disabled={!config?.allowSaveCommand || busy}
                  >
                    Guardar en el volante
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={repeatPedal}
                    disabled={busy}
                  >
                    Repetir
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void cancel()}
                    disabled={busy}
                  >
                    Cancelar y restaurar
                  </Button>
                </div>
              </>
            )}

          </div>
        )}

        {message && (
          <p className="muted wizard-message" role="status">
            {message}
          </p>
        )}
      </div>

      <details className="axis-raw">
        <summary>
          Todos los ejes
          <em>{axes.buttons.length} botones pulsados</em>
        </summary>
        <div className="axis-raw-grid">
          {[
            { key: "x", label: "X" },
            { key: "y", label: "Y" },
            { key: "z", label: "Z" },
            { key: "rx", label: "Rx" },
            { key: "ry", label: "Ry" },
            { key: "rz", label: "Rz" },
            { key: "slider", label: "Slider" },
            { key: "dial", label: "Dial" },
          ].map((axis) => (
            <AxisBar
              key={axis.key}
              label={axis.label}
              value={axes[axis.key as keyof JoystickAxes] as number}
              compact
            />
          ))}
        </div>
      </details>

      <p className="muted">
        El eje del pedal es con signo (-32767…+32767): la barra muestra el
        recorrido completo. La calibración de dos puntos se guarda en el
        firmware; no se aplica en la web.
      </p>
    </div>
  );
}
