import React, { useState } from "react";
import { useHub } from "../hub";
import { WheelGauge } from "../components/Gauge";
import { SingleField } from "../components/GroupFields";
import { Button, Card, PageHeader, Stat } from "../components/ui";

export function Dashboard(): React.ReactElement {
  const { status, settings, runCommand, refreshAll } = useHub();
  const [busy, setBusy] = useState<string | null>(null);
  const connected = Boolean(status?.connected);
  const readOnly = Boolean(status?.readOnly);

  const run = async (name: string): Promise<void> => {
    if (name === "save" && !window.confirm("¿Guardar los ajustes y reiniciar el volante?")) return;
    setBusy(name);
    try {
      await runCommand(name);
    } catch {
      // el aviso ya se muestra en el toast
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Estado del volante en tiempo real."
        actions={
          <Button
            variant="ghost"
            icon="refresh"
            disabled={!connected}
            onClick={() => void refreshAll()}
          >
            Refrescar
          </Button>
        }
      />

      <div className="grid grid-2">
        <Card
          title="Posición y torque"
          subtitle={connected ? "En vivo a 20 Hz" : "Sin datos"}
          tone="accent"
        >
          <WheelGauge />
        </Card>

        <Card title="Estado del sistema">
          <div className="stats">
            <Stat
              label="Volante"
              value={connected ? "Conectado" : "Desconectado"}
              tone={connected ? "ok" : "warn"}
            />
            <Stat label="Firmware" value={status?.firmware ?? "—"} />
            <Stat
              label="Licencia"
              value={
                status?.license ? (status.license.isRegistered ? "PRO" : "Free") : "—"
              }
              tone={status?.license?.isRegistered ? "ok" : "neutral"}
            />
            <Stat
              label="Recorrido"
              value={settings ? `${settings.effects.motionRange}°` : "—"}
            />
            <Stat
              label="Fuerza"
              value={
                settings ? (settings.hardware.forceEnabled ? "Activada" : "Desactivada") : "—"
              }
              tone={settings?.hardware.forceEnabled ? "accent" : "neutral"}
            />
            <Stat label="Modo" value={status?.mock ? "Simulado" : "Real"} />
          </div>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Acciones" subtitle="Se aplican de inmediato.">
          <div className="row wrap">
            <Button
              variant="primary"
              icon="axis"
              disabled={!connected || readOnly || busy !== null}
              onClick={() => void run("reset-center")}
            >
              Reset de centro
            </Button>
            <Button
              icon="save"
              disabled={!connected || readOnly || busy !== null}
              onClick={() => void run("save")}
            >
              Guardar y reiniciar
            </Button>
            <Button
              variant="ghost"
              icon="refresh"
              disabled={!connected}
              onClick={() => void refreshAll()}
            >
              Releer ajustes
            </Button>
          </div>
          <p className="muted">
            Guardar reinicia el firmware. El hub se reconecta solo en 1-2 segundos.
          </p>
        </Card>

        <Card title="Ajustes rápidos">
          <div className="fields compact">
            <SingleField name="motionRange" />
            <SingleField name="totalEffectStrength" />
            <SingleField name="staticDampeningStrength" />
          </div>
          {!settings && <p className="muted">Conecta el volante para ver y editar ajustes.</p>}
        </Card>
      </div>
    </>
  );
}
