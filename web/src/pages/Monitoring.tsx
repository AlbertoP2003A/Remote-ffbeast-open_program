import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MonitorChart, type MonitorSample } from "../components/MonitorChart";
import { PedalPanel } from "../components/PedalPanel";
import { Badge, Banner, Button, Card, EmptyState, PageHeader, Stat } from "../components/ui";
import { useHub } from "../hub";
import { useLiveState } from "../live";

const MAX_SAMPLES = 600;

export function Monitoring(): React.ReactElement {
  const live = useLiveState();
  const { settings, status, notify } = useHub();
  const [samples, setSamples] = useState<MonitorSample[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!live || paused) return;
    setSamples((current) => {
      if (current.length > 0 && current[current.length - 1].t === live.timestamp) return current;
      const next = [
        ...current,
        { t: live.timestamp, position: live.positionDegrees, torque: live.torquePercent },
      ];
      return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
    });
  }, [live, paused]);

  const last = samples[samples.length - 1];
  const now = paused ? (last?.t ?? Date.now()) : (live?.timestamp ?? last?.t ?? Date.now());
  const half = (settings?.effects.motionRange ?? 900) / 2;

  const stats = useMemo(() => {
    if (samples.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const sample of samples) {
      min = Math.min(min, sample.position);
      max = Math.max(max, sample.position);
      sum += sample.position;
    }
    return { min, max, avg: sum / samples.length };
  }, [samples]);

  const clear = (): void => {
    setSamples([]);
    notify("Monitor limpiado", "info");
  };

  const exportCsv = (): void => {
    if (samples.length === 0) return;
    const header = "timestamp_iso,position_deg,torque_percent";
    const rows = samples.map(
      (sample) =>
        `${new Date(sample.t).toISOString()},${sample.position.toFixed(3)},${sample.torque.toFixed(3)}`,
    );
    const blob = new Blob([[header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ffbeast-monitor-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify(`${samples.length} muestras exportadas`, "success");
  };

  const connected = Boolean(status?.connected);

  return (
    <>
      <PageHeader
        title="Monitor"
        subtitle="Posición y torque en los últimos 30 segundos."
        actions={
          <div className="row wrap">
            <Button
              variant={paused ? "primary" : "ghost"}
              size="sm"
              icon={paused ? "play" : "pause"}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? "Reanudar" : "Pausa"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon="trash"
              onClick={clear}
              disabled={samples.length === 0}
            >
              Limpiar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon="download"
              onClick={exportCsv}
              disabled={samples.length === 0}
            >
              CSV
            </Button>
          </div>
        }
      />

      {settings && settings.gpio.extensionMode === 0 && (
        <Banner tone="warn" icon="alert" title="Los pedales necesitan la extensión activada">
          Ve a <Link to="/pins">Pines</Link>, pon «Modo de extensión = Personalizado»
          y pulsa «Aplicar y reiniciar». Después vuelve aquí y pisa los pedales.
        </Banner>
      )}

      {!connected && samples.length === 0 ? (
        <Card>
          <EmptyState icon="chart" title="Sin datos del volante">
            Conecta el volante para ver la telemetría.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card
            title="Telemetría en vivo"
            subtitle={
              <span className="live-subtitle">
                <span className={`live-dot${paused ? " is-paused" : ""}`} />
                {paused ? "En pausa" : "20 Hz · ventana de 30 s"}
              </span>
            }
            actions={
              <Badge tone={paused ? "warn" : "ok"} dot>
                {paused ? "Pausado" : "En vivo"}
              </Badge>
            }
          >
            <MonitorChart samples={samples} now={now} halfRange={half} />
            <div className="chart-legend">
              <span className="chart-legend-item">
                <span className="chart-swatch is-position" />
                Posición
              </span>
              <span className="chart-legend-item">
                <span className="chart-swatch is-torque" />
                Torque
              </span>
              <span className="chart-legend-note">
                {samples.length} muestras · recorrido ±{half.toFixed(0)}°
              </span>
            </div>
          </Card>

          <Card
            title="Pedales y ejes"
            subtitle={
              live?.axes
                ? `${live.axes.buttons.length} botones pulsados · interfaz de joystick`
                : "Esperando la interfaz de joystick"
            }
            actions={
              <Badge tone={live?.axes ? "ok" : "warn"} dot>
                {live?.axes ? "Joystick" : "Sin ejes"}
              </Badge>
            }
          >
            <PedalPanel axes={live?.axes} />
          </Card>

          <Card title="Resumen">
            <div className="stats">
              <Stat
                label="Posición"
                value={live ? `${live.positionDegrees.toFixed(1)}°` : "—"}
                tone="accent"
              />
              <Stat
                label="Torque"
                value={live ? `${live.torquePercent.toFixed(0)}%` : "—"}
              />
              <Stat
                label="Mín / Máx"
                value={stats ? `${stats.min.toFixed(1)}° / ${stats.max.toFixed(1)}°` : "—"}
              />
              <Stat label="Media" value={stats ? `${stats.avg.toFixed(1)}°` : "—"} />
              <Stat label="Muestras" value={samples.length} />
              <Stat label="Ventana" value="30 s" />
            </div>
          </Card>
        </>
      )}
    </>
  );
}
