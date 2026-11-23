import React from "react";

export interface MonitorSample {
  t: number;
  position: number;
  torque: number;
}

const W = 840;
const H = 320;
const PAD = { l: 58, r: 58, t: 22, b: 34 };
const WINDOW_MS = 30_000;

export function MonitorChart({
  samples,
  now,
  halfRange,
}: {
  samples: MonitorSample[];
  now: number;
  halfRange: number;
}): React.ReactElement {
  const t0 = now - WINDOW_MS;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const baseY = PAD.t + innerH;
  const visible = samples.filter((sample) => sample.t >= t0 && sample.t <= now);

  const x = (t: number): number => PAD.l + ((t - t0) / WINDOW_MS) * innerW;
  const yPos = (value: number): number =>
    PAD.t + (1 - (value + halfRange) / (2 * halfRange)) * innerH;
  const yTorque = (value: number): number =>
    PAD.t + (1 - (value + 100) / 200) * innerH;

  const posPath = visible
    .map(
      (sample, index) =>
        `${index === 0 ? "M" : "L"}${x(sample.t).toFixed(1)} ${yPos(sample.position).toFixed(1)}`,
    )
    .join(" ");
  const torquePath = visible
    .map(
      (sample, index) =>
        `${index === 0 ? "M" : "L"}${x(sample.t).toFixed(1)} ${yTorque(sample.torque).toFixed(1)}`,
    )
    .join(" ");

  const last = visible[visible.length - 1];
  const areaPath =
    visible.length > 1
      ? `${posPath} L ${x(visible[visible.length - 1].t).toFixed(1)} ${baseY.toFixed(
          1,
        )} L ${x(visible[0].t).toFixed(1)} ${baseY.toFixed(1)} Z`
      : "";

  const ySteps = [-1, -0.5, 0, 0.5, 1];
  const timeMarks = [0, 10, 20, 30];

  return (
    <svg
      className="monitor-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Gráfica de posición y torque de los últimos 30 segundos"
    >
      <defs>
        <linearGradient id="monitor-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb020" stopOpacity="0.3" />
          <stop offset="1" stopColor="#ffb020" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="monitor-pos" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff7a1a" />
          <stop offset="0.5" stopColor="#ffb020" />
          <stop offset="1" stopColor="#ffd27a" />
        </linearGradient>
      </defs>

      {ySteps.map((step) => {
        const y = PAD.t + (1 - (step + 1) / 2) * innerH;
        return (
          <g key={step}>
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} className="chart-grid" />
            <text x={PAD.l - 10} y={y + 4} textAnchor="end" className="chart-label">
              {step === 0 ? "0°" : `${step > 0 ? "+" : ""}${(step * halfRange).toFixed(0)}°`}
            </text>
            <text
              x={W - PAD.r + 10}
              y={y + 4}
              textAnchor="start"
              className="chart-label chart-label-torque"
            >
              {step === 0 ? "0%" : `${step > 0 ? "+" : ""}${(step * 100).toFixed(0)}%`}
            </text>
          </g>
        );
      })}

      {timeMarks.map((seconds) => {
        const markX = PAD.l + (seconds / 30) * innerW;
        return (
          <g key={seconds}>
            <line x1={markX} y1={PAD.t} x2={markX} y2={baseY} className="chart-grid chart-grid-v" />
            <text
              x={markX}
              y={H - 12}
              textAnchor={seconds === 0 ? "start" : seconds === 30 ? "end" : "middle"}
              className="chart-label"
            >
              {seconds === 30 ? "ahora" : `-${30 - seconds} s`}
            </text>
          </g>
        );
      })}

      {areaPath && <path d={areaPath} className="chart-area" />}
      {torquePath && <path d={torquePath} className="chart-line chart-line-torque" />}
      {posPath && <path d={posPath} className="chart-line chart-line-position" />}

      {last && (
        <>
          <line x1={x(last.t)} y1={PAD.t} x2={x(last.t)} y2={baseY} className="chart-now" />
          <circle cx={x(last.t)} cy={yPos(last.position)} r="4" className="chart-dot" />
        </>
      )}

      {visible.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" className="chart-empty">
          Esperando datos del volante…
        </text>
      )}
    </svg>
  );
}
