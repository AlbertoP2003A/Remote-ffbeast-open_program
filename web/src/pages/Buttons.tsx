import React, { useEffect, useMemo, useState } from "react";
import { useHub } from "../hub";
import type { GpioSettings } from "../types";
import { DraftBar } from "../components/DraftBar";
import { Badge, Banner, Button, Card, EmptyState, PageHeader } from "../components/ui";

const MODE_LABELS = ["Ninguno", "Normal", "Invertido", "Pulso", "Pulso invertido"];
const MODE_SHORT = ["—", "NORM", "INV", "PULSO", "P.INV"];
const MODE_ORDER = [0, 1, 2, 3, 4];

function nextMode(mode: number): number {
  const index = MODE_ORDER.indexOf(mode);
  return MODE_ORDER[(index + 1) % MODE_ORDER.length] ?? 0;
}

export function Buttons(): React.ReactElement {
  const { settings, status, applySettings } = useHub();
  const [draft, setDraft] = useState<GpioSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkMode, setBulkMode] = useState(1);

  useEffect(() => {
    if (settings) setDraft(structuredClone(settings.gpio));
  }, [settings]);

  const readOnly = Boolean(status?.readOnly);
  const connected = Boolean(status?.connected);
  const locked = readOnly || !connected;

  const changes = useMemo(() => {
    if (!draft || !settings) return 0;
    let count = 0;
    for (let i = 0; i < 32; i += 1) {
      if (draft.buttonMode[i] !== settings.gpio.buttonMode[i]) count += 1;
    }
    return count;
  }, [draft, settings]);

  const setButton = (index: number, mode: number): void => {
    setDraft((current) => {
      if (!current) return current;
      const buttonMode = [...current.buttonMode];
      buttonMode[index] = mode;
      return { ...current, buttonMode };
    });
  };

  const setAll = (): void => {
    setDraft((current) =>
      current
        ? { ...current, buttonMode: Array.from({ length: 32 }, () => bulkMode) }
        : current,
    );
  };

  const discard = (): void => {
    if (settings) setDraft(structuredClone(settings.gpio));
  };

  const apply = async (): Promise<void> => {
    if (!draft) return;
    if (
      !window.confirm(
        "Se guardarán los 32 botones y el volante se reiniciará para aplicarlos.\n\n¿Continuar?",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await applySettings({ gpio: draft });
    } catch {
      // el toast ya informa
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Botones"
        subtitle="Modos de los 32 botones de la extensión."
        actions={<Badge tone="warn">Requiere reinicio</Badge>}
      />

      <Banner tone="info" icon="alert" title="Se aplica al guardar y reiniciar">
        Haz clic en un botón para ir cambiando su modo. Al terminar, aplica todo de
        una vez.
      </Banner>

      {!settings || !draft ? (
        <Card>
          <EmptyState icon="grid" title="Conecta el volante">
            Los 32 botones se leen del volante al conectarlo.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card
            title="Matriz de 32 botones"
            subtitle="Cada celda muestra el modo actual."
          >
            <div className="button-legend">
              {MODE_LABELS.map((label, index) => (
                <span key={label} className={`legend-item legend-mode-${index}`}>
                  <span className="legend-dot" />
                  {label}
                </span>
              ))}
            </div>

            <div className="bulk-row">
              <span>Modo para todos:</span>
              <select
                className="select select-sm"
                value={bulkMode}
                disabled={locked}
                onChange={(event) => setBulkMode(Number(event.target.value))}
              >
                {MODE_LABELS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={setAll} disabled={locked}>
                Aplicar a todos
              </Button>
            </div>

            <div className="button-grid">
              {draft.buttonMode.map((mode, index) => (
                <button
                  key={index}
                  type="button"
                  className={`button-cell button-mode-${mode}`}
                  onClick={() => setButton(index, nextMode(mode))}
                  disabled={locked}
                  title={`Botón ${index + 1}: ${MODE_LABELS[mode] ?? "Desconocido"}`}
                  aria-label={`Botón ${index + 1}: ${MODE_LABELS[mode] ?? "Desconocido"}`}
                >
                  <span className="button-num">{index + 1}</span>
                  <span className="button-mode">{MODE_SHORT[mode] ?? "?"}</span>
                </button>
              ))}
            </div>
          </Card>

          <DraftBar
            changes={changes}
            busy={busy}
            disabled={locked}
            onDiscard={discard}
            onApply={() => void apply()}
          />
        </>
      )}
    </>
  );
}
