import React from "react";
import { Link } from "react-router-dom";
import { useHub } from "../hub";
import { useLiveState } from "../live";
import type { FieldDef } from "../types";
import { FieldRow } from "../components/controls";
import { pedalPercent } from "../components/PedalPanel";
import { Banner, Card, EmptyState, PageHeader } from "../components/ui";

function AxisLive({ index }: { index: number }): React.ReactElement | null {
  const live = useLiveState();
  if (!live?.axes) return null;
  const raw = [live.axes.rx, live.axes.ry, live.axes.rz][index];
  if (raw === undefined) return null;
  const pct = pedalPercent(raw);
  return (
    <div className="axis-live">
      <span className="axis-live-label">En vivo</span>
      <div className="axis-live-track">
        <span className="axis-live-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="axis-live-value">{pct.toFixed(0)}%</span>
    </div>
  );
}

function synthetic(base: FieldDef | undefined, name: string, label: string): FieldDef {
  return {
    name,
    id: base?.id ?? 0,
    type: base?.type ?? "u8",
    group: "adc",
    label,
    unit: base?.unit,
    min: base?.min ?? 0,
    max: base?.max ?? 100,
    step: base?.step ?? 1,
    advanced: true,
    readback: true,
    description: base?.description,
    options: base?.options,
  };
}

export function Axes(): React.ReactElement {
  const { settings, fields, writable, setField } = useHub();
  const locked = !writable;

  const base = (name: string): FieldDef | undefined =>
    fields.find((item) => item.name === name);

  const minBase = base("adcMinDeadZone");
  const maxBase = base("adcMaxDeadZone");
  const smoothingBase = base("adcSmoothing");
  const lowBase = base("adcToButtonLow");
  const highBase = base("adcToButtonHigh");
  const invertBase = base("adcInvert");

  return (
    <>
      <PageHeader
        title="Ejes"
        subtitle="Zonas muertas, suavizado y umbrales de los 3 ejes ADC."
      />

      <Banner tone="info" icon="check" title="Se aplican en vivo">
        Los ejes no necesitan reinicio: el cambio se escribe y se verifica al soltar
        el control.
      </Banner>

      {settings && settings.gpio.extensionMode === 0 && (
        <Banner tone="warn" icon="alert" title="La extensión está desactivada">
          Los pines 1–3 están en modo analógico, pero el modo de extensión está en
          «Ninguno», así que el volante no está leyendo los pedales. Ve a{" "}
          <Link to="/pins">Pines</Link>, pon «Modo de extensión = Personalizado» y
          pulsa «Aplicar y reiniciar». Después vuelve aquí y prueba a pisar los
          pedales.
        </Banner>
      )}

      {!settings ? (
        <Card>
          <EmptyState icon="axis" title="Conecta el volante">
            Los ejes se leen del volante al conectarlo.
          </EmptyState>
        </Card>
      ) : (
        <div className="axis-grid">
          {[0, 1, 2].map((index) => {
            const min = settings.adc.adcMinDeadZone[index] ?? 0;
            const max = settings.adc.adcMaxDeadZone[index] ?? 65535;
            const low = settings.adc.adcToButtonLow[index] ?? 0;
            const high = settings.adc.adcToButtonHigh[index] ?? 100;
            const minPct = (min / 65535) * 100;
            const maxPct = (max / 65535) * 100;
            const bandLeft = Math.min(minPct, maxPct);
            const bandWidth = Math.abs(maxPct - minPct);

            return (
              <Card
                key={index}
                title={`Eje R${index + 1}`}
                subtitle="Entrada analógica"
              >
                <AxisLive index={index} />
                <div className="axis-visual">
                  <div className="axis-bar">
                    <span
                      className="axis-band"
                      style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
                    />
                    <span
                      className="axis-marker"
                      style={{ left: `${low}%` }}
                      title={`Umbral bajo: ${low}%`}
                    />
                    <span
                      className="axis-marker is-high"
                      style={{ left: `${high}%` }}
                      title={`Umbral alto: ${high}%`}
                    />
                  </div>
                  <div className="axis-scale">
                    <span>0</span>
                    <span>65535</span>
                  </div>
                  <div className="axis-values">
                    <span>
                      Zona muerta {min}–{max}
                    </span>
                    <span>
                      Botón {low}% / {high}%
                    </span>
                  </div>
                </div>

                <div className="fields compact">
                  <FieldRow
                    field={synthetic(minBase, `adcMinDeadZone-${index}`, "Zona muerta mínima")}
                    value={min}
                    disabled={locked}
                    onCommit={(value) => void setField("adcMinDeadZone", value, index)}
                  />
                  <FieldRow
                    field={synthetic(maxBase, `adcMaxDeadZone-${index}`, "Zona muerta máxima")}
                    value={max}
                    disabled={locked}
                    onCommit={(value) => void setField("adcMaxDeadZone", value, index)}
                  />
                  <FieldRow
                    field={synthetic(smoothingBase, `adcSmoothing-${index}`, "Suavizado")}
                    value={settings.adc.adcSmoothing[index] ?? 0}
                    disabled={locked}
                    onCommit={(value) => void setField("adcSmoothing", value, index)}
                  />
                  <FieldRow
                    field={synthetic(lowBase, `adcToButtonLow-${index}`, "Umbral bajo de botón")}
                    value={low}
                    disabled={locked}
                    onCommit={(value) => void setField("adcToButtonLow", value, index)}
                  />
                  <FieldRow
                    field={synthetic(highBase, `adcToButtonHigh-${index}`, "Umbral alto de botón")}
                    value={high}
                    disabled={locked}
                    onCommit={(value) => void setField("adcToButtonHigh", value, index)}
                  />
                  <FieldRow
                    field={synthetic(invertBase, `adcInvert-${index}`, "Invertir eje")}
                    value={settings.adc.adcInvert[index] ?? 0}
                    disabled={locked}
                    onCommit={(value) => void setField("adcInvert", value, index)}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
