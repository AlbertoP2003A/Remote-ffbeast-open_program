import React from "react";
import { useHub } from "../hub";
import { useLiveState } from "../live";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function WheelGauge(): React.ReactElement {
  const { settings, status } = useHub();
  const live = useLiveState();
  const range = settings?.effects.motionRange ?? 900;
  const half = range / 2 || 1;
  const degrees = live?.positionDegrees ?? 0;
  const ratio = clamp(degrees / half, -1, 1);
  const rotation = ratio * 84;
  const torque = live?.torquePercent ?? 0;
  const torqueRatio = clamp(torque / 100, -1, 1);
  const torqueWidth = Math.abs(torqueRatio) * 50;
  const torqueLeft = torqueRatio >= 0 ? 50 : 50 - torqueWidth;

  const arcRadius = 80;
  const needleAngle = (rotation * Math.PI) / 180;
  const arcEndX = 110 + arcRadius * Math.sin(needleAngle);
  const arcEndY = 120 - arcRadius * Math.cos(needleAngle);
  const arcSweep = rotation >= 0 ? 1 : 0;
  const progressPath = `M 110 40 A ${arcRadius} ${arcRadius} 0 0 ${arcSweep} ${arcEndX.toFixed(
    2,
  )} ${arcEndY.toFixed(2)}`;

  return (
    <div className="gauge">
      <svg viewBox="0 0 220 150" role="img" aria-label={`Posición ${degrees.toFixed(1)} grados`}>
        <defs>
          <linearGradient id="gauge-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ff7a1a" />
            <stop offset="0.5" stopColor="#ffb020" />
            <stop offset="1" stopColor="#ff7a1a" />
          </linearGradient>
        </defs>
        <path d="M 30 120 A 80 80 0 0 1 190 120" className="gauge-track" />
        <path d={progressPath} className="gauge-progress" />
        {[-84, -42, 0, 42, 84].map((angle) => (
          <line
            key={angle}
            x1="110"
            y1="32"
            x2="110"
            y2={angle === 0 ? 44 : 40}
            className="gauge-tick"
            transform={`rotate(${angle} 110 120)`}
          />
        ))}
        <line
          x1="110"
          y1="120"
          x2="110"
          y2="52"
          className="gauge-needle"
          transform={`rotate(${rotation} 110 120)`}
        />
        <circle cx="110" cy="120" r="7" className="gauge-hub" />
      </svg>

      <div className="gauge-readout">
        <strong>
          {degrees >= 0 ? "+" : ""}
          {degrees.toFixed(1)}°
        </strong>
        <span>
          {live
            ? `${torque >= 0 ? "+" : ""}${torque.toFixed(0)}% de torque`
            : status?.connected
              ? "esperando datos"
              : "volante desconectado"}
        </span>
      </div>

      <div className="torque">
        <div className="torque-track" aria-hidden="true">
          <span className="torque-zero" />
          <span
            className={`torque-fill${torqueRatio < 0 ? " is-negative" : ""}`}
            style={{ left: `${torqueLeft}%`, width: `${torqueWidth}%` }}
          />
        </div>
        <div className="torque-labels">
          <span>-100%</span>
          <span>torque</span>
          <span>+100%</span>
        </div>
      </div>

      <p className="gauge-range">Recorrido configurado: ±{(range / 2).toFixed(0)}°</p>
    </div>
  );
}
