import React, { useEffect, useState } from "react";
import type { JoystickAxes } from "../types";
import { Button } from "./ui";

const STORAGE_KEY = "ffbeast.pedalCalibration";

const PEDALS = [
  { key: "rx", label: "Pedal 1", hid: "Rx" },
  { key: "ry", label: "Pedal 2", hid: "Ry" },
  { key: "rz", label: "Pedal 3", hid: "Rz" },
] as const;

type PedalKey = (typeof PEDALS)[number]["key"];

interface Calibration {
  zero?: number;
  full?: number;
}

type CalibrationMap = Partial<Record<PedalKey, Calibration>>;

function loadCalibration(): CalibrationMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CalibrationMap) : {};
  } catch {
    return {};
  }
}

/** Los ejes de pedal son unipolares 0..32767 (no centrados en 0). */
export function pedalPercent(value: number): number {
  return Math.max(0, Math.min(100, (value / 32767) * 100));
}

function displayPercent(value: number, calibration?: Calibration): number {
  if (
    calibration &&
    calibration.zero !== undefined &&
    calibration.full !== undefined &&
    calibration.full !== calibration.zero
  ) {
    const pct = ((value - calibration.zero) / (calibration.full - calibration.zero)) * 100;
    return Math.max(0, Math.min(100, pct));
  }
  return pedalPercent(value);
}

function AxisBar({
  label,
  hid,
  value,
  compact = false,
  calibration,
}: {
  label: string;
  hid?: string;
  value: number;
  compact?: boolean;
  calibration?: Calibration;
}): React.ReactElement {
  const pct = displayPercent(value, calibration);
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

export function PedalPanel({
  axes,
}: {
  axes: JoystickAxes | null | undefined;
}): React.ReactElement {
  const [calibration, setCalibration] = useState<CalibrationMap>(loadCalibration);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration));
    } catch {
      // modo privado: la calibración vive solo en memoria
    }
  }, [calibration]);

  if (!axes) {
    return (
      <p className="muted">
        El volante no está enviando la interfaz de joystick. Reconéctalo o revisa
        que no esté en modo DFU.
      </p>
    );
  }

  const capture = (key: PedalKey, field: keyof Calibration): void => {
    setCalibration((current) => ({
      ...current,
      [key]: { ...current[key], [field]: axes[key] },
    }));
  };

  const reset = (): void => setCalibration({});
  const calibratedCount = PEDALS.filter((pedal) => {
    const value = calibration[pedal.key];
    return value?.zero !== undefined && value?.full !== undefined;
  }).length;

  return (
    <div className="pedal-panel">
      <div className="pedal-grid">
        {PEDALS.map((pedal) => (
          <AxisBar
            key={pedal.key}
            label={pedal.label}
            hid={pedal.hid}
            value={axes[pedal.key]}
            calibration={calibration[pedal.key]}
          />
        ))}
      </div>

      <details className="pedal-calibration">
        <summary>
          Calibrar pedales
          <em>
            {calibratedCount}/{PEDALS.length} calibrados
          </em>
        </summary>
        <p className="muted">
          Deja el pedal suelto y pulsa «Cero». Písalo a fondo y pulsa «Fondo». La
          calibración se guarda en este dispositivo y hace que el reposo sea 0 % y
          el fondo 100 %.
        </p>
        <div className="calibration-grid">
          {PEDALS.map((pedal) => (
            <div key={pedal.key} className="calibration-row">
              <span className="calibration-name">
                {pedal.label}
                <em>{axes[pedal.key]}</em>
              </span>
              <Button size="sm" variant="ghost" onClick={() => capture(pedal.key, "zero")}>
                Cero
              </Button>
              <Button size="sm" variant="ghost" onClick={() => capture(pedal.key, "full")}>
                Fondo
              </Button>
              <span className="calibration-state">
                {calibration[pedal.key]?.zero !== undefined &&
                calibration[pedal.key]?.full !== undefined
                  ? `${calibration[pedal.key]?.zero} → ${calibration[pedal.key]?.full}`
                  : "sin calibrar"}
              </span>
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={reset}
          disabled={Object.keys(calibration).length === 0}
        >
          Restablecer calibración
        </Button>
      </details>

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
        El reposo no cae en 0 % porque el eje es unipolar (0…32767) y está
        invertido en el volante. Con la calibración de dos puntos se corrige en la
        UI; la escala cruda sigue visible a la derecha.
      </p>
    </div>
  );
}
