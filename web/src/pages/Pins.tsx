import React, { useEffect, useMemo, useState } from "react";
import { useHub } from "../hub";
import type { FieldDef, GpioSettings } from "../types";
import { DraftBar } from "../components/DraftBar";
import { FieldRow } from "../components/controls";
import { Badge, Banner, Card, EmptyState, PageHeader } from "../components/ui";

export function Pins(): React.ReactElement {
  const { settings, fields, status, applySettings } = useHub();
  const [draft, setDraft] = useState<GpioSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) setDraft(structuredClone(settings.gpio));
  }, [settings]);

  const field = (name: string): FieldDef | undefined =>
    fields.find((item) => item.name === name);

  const pinField = field("pinMode");
  const extensionField = field("extensionMode");
  const spiModeField = field("spiMode");
  const spiLatchField = field("spiLatchMode");
  const spiDelayField = field("spiLatchDelay");
  const spiClkField = field("spiClkPulseLength");

  const readOnly = Boolean(status?.readOnly);
  const connected = Boolean(status?.connected);
  const locked = readOnly || !connected;

  const changes = useMemo(() => {
    if (!draft || !settings) return 0;
    const base = settings.gpio;
    let count = 0;
    if (draft.extensionMode !== base.extensionMode) count += 1;
    for (let i = 0; i < 10; i += 1) {
      if (draft.pinMode[i] !== base.pinMode[i]) count += 1;
    }
    if (draft.spiMode !== base.spiMode) count += 1;
    if (draft.spiLatchMode !== base.spiLatchMode) count += 1;
    if (draft.spiLatchDelay !== base.spiLatchDelay) count += 1;
    if (draft.spiClkPulseLength !== base.spiClkPulseLength) count += 1;
    return count;
  }, [draft, settings]);

  const update = (patch: Partial<GpioSettings>): void => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const setPin = (index: number, value: number): void => {
    setDraft((current) => {
      if (!current) return current;
      const pinMode = [...current.pinMode];
      pinMode[index] = value;
      return { ...current, pinMode };
    });
  };

  const discard = (): void => {
    if (settings) setDraft(structuredClone(settings.gpio));
  };

  const apply = async (): Promise<void> => {
    if (!draft) return;
    if (
      !window.confirm(
        "Se guardarán los pines y el volante se reiniciará para aplicarlos.\n\n¿Continuar?",
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
        title="Pines"
        subtitle="Modos de los 10 pines, extensión y bus SPI."
        actions={<Badge tone="warn">Requiere reinicio</Badge>}
      />

      <Banner tone="info" icon="alert" title="Se aplica al guardar y reiniciar">
        Edita todo lo que necesites y aplica una sola vez: el volante se reinicia y
        vuelve solo en 2–5 segundos.
      </Banner>

      {!settings || !draft ? (
        <Card>
          <EmptyState icon="chip" title="Conecta el volante">
            Los pines se leen del volante al conectarlo.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid grid-2">
            <Card title="Modo de extensión">
              {extensionField ? (
                <FieldRow
                  field={extensionField}
                  value={draft.extensionMode}
                  disabled={locked}
                  onCommit={(value) => update({ extensionMode: value })}
                />
              ) : (
                <p className="muted">El volante no ha enviado este campo.</p>
              )}
              <p className="muted">
                «Personalizado» habilita los pines y botones de la extensión.
              </p>
            </Card>

            <Card title="Bus SPI">
              <div className="fields compact">
                {spiModeField && (
                  <FieldRow
                    field={spiModeField}
                    value={draft.spiMode}
                    disabled={locked}
                    onCommit={(value) => update({ spiMode: value })}
                  />
                )}
                {spiLatchField && (
                  <FieldRow
                    field={spiLatchField}
                    value={draft.spiLatchMode}
                    disabled={locked}
                    onCommit={(value) => update({ spiLatchMode: value })}
                  />
                )}
                {spiDelayField && (
                  <FieldRow
                    field={spiDelayField}
                    value={draft.spiLatchDelay}
                    disabled={locked}
                    onCommit={(value) => update({ spiLatchDelay: value })}
                  />
                )}
                {spiClkField && (
                  <FieldRow
                    field={spiClkField}
                    value={draft.spiClkPulseLength}
                    disabled={locked}
                    onCommit={(value) => update({ spiClkPulseLength: value })}
                  />
                )}
              </div>
            </Card>
          </div>

          <Card
            title="Pines (10)"
            subtitle="Cada pin puede ser entrada, salida, SPI o una función del volante."
          >
            <div className="pin-grid">
              {draft.pinMode.map((mode, index) => (
                <label className="pin-card" key={index} data-set={mode !== 0}>
                  <span className="pin-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="pin-body">
                    <span className="pin-title">Pin {index + 1}</span>
                    <select
                      className="select select-sm"
                      value={mode}
                      disabled={locked}
                      onChange={(event) => setPin(index, Number(event.target.value))}
                    >
                      {(pinField?.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className={`pin-dot pin-mode-${mode}`} aria-hidden="true" />
                </label>
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
