import React, { useState } from "react";
import { useHub } from "../hub";
import { WheelGauge } from "../components/Gauge";
import { SingleField } from "../components/GroupFields";
import { HoldButton } from "../components/controls";
import { SafetyNotice } from "../components/SafetyNotice";
import { Banner, Button, Card, PageHeader, Stat } from "../components/ui";

export function Dashboard(): React.ReactElement {
  const {
    status,
    settings,
    session,
    writable,
    runCommand,
    refreshAll,
    disableForces,
    updateConfig,
  } = useHub();
  const [busy, setBusy] = useState<string | null>(null);
  const connected = Boolean(status?.connected);
  const readOnly = Boolean(status?.readOnly);
  const forceEnabled = Boolean(settings?.hardware.forceEnabled);

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

  const disable = async (): Promise<void> => {
    setBusy("disable-forces");
    try {
      await disableForces();
    } catch {
      // el aviso ya se muestra en el toast
    } finally {
      setBusy(null);
    }
  };

  const enableRaceMode = async (): Promise<void> => {
    try {
      await updateConfig({ readOnly: true });
    } catch {
      // el aviso ya se muestra en el toast
    }
  };

  const disableRaceMode = async (): Promise<void> => {
    try {
      await updateConfig({ readOnly: false });
    } catch {
      // el aviso ya se muestra en el toast
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

      {forceEnabled && (
        <Banner tone="warn" icon="power" title="Fuerza activada">
          El volante puede ejercer fuerza. Sujétalo y mantén las manos fuera del
          radio de giro antes de cambiar ajustes.
        </Banner>
      )}
      <SafetyNotice />

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
            <HoldButton
              variant="primary"
              icon="axis"
              disabled={!writable || busy !== null}
              onConfirm={() => void run("reset-center")}
              title="Mantén 1,5 s para restablecer el centro"
            >
              Reset de centro
            </HoldButton>
            <HoldButton
              variant="danger"
              icon="power"
              disabled={!writable || busy !== null || !forceEnabled}
              onConfirm={() => void disable()}
              title="Mantén 1,5 s para desactivar la fuerza y reiniciar"
            >
              Desactivar fuerzas
            </HoldButton>
            <Button
              icon="save"
              disabled={!writable || busy !== null}
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
            {!readOnly ? (
              <Button
                variant="ghost"
                icon="power"
                disabled={!status}
                onClick={() => void enableRaceMode()}
              >
                Modo lectura
              </Button>
            ) : (
              session?.loopback && (
                <Button
                  variant="ghost"
                  icon="power"
                  disabled={!status}
                  onClick={() => void disableRaceMode()}
                >
                  Modo carrera
                </Button>
              )
            )}
          </div>
          <p className="muted">
            Reset de centro y desactivar fuerzas se confirman manteniendo pulsado
            1,5 s. Desactivar fuerzas guarda y reinicia (~2 s); para un corte
            inmediato usa el interruptor del volante.
          </p>
          <p className="muted">
            {readOnly
              ? session?.loopback
                ? "Modo lectura activo: las escrituras están bloqueadas. Pulsa «Modo carrera» para volver a escribir."
                : "Modo lectura activo: las escrituras están bloqueadas. Desactívalo desde el PC."
              : "Guardar reinicia el firmware. El hub se reconecta solo en 1-2 segundos."}
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
