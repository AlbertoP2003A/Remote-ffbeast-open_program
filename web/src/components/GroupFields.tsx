import React from "react";
import { useHub } from "../hub";
import type { FieldDef } from "../types";
import { FieldRow } from "./controls";

function valueOf(
  settings: NonNullable<ReturnType<typeof useHub>["settings"]>,
  field: FieldDef,
): number | null {
  if (field.group === "misc") return null;
  const bag = settings[field.group] as unknown as Record<string, number | number[]>;
  const value = bag[field.name];
  return typeof value === "number" ? value : null;
}

function confirmChange(field: FieldDef, value: number): boolean {
  if (field.name === "forceEnabled") {
    const action = value === 1 ? "activar" : "desactivar";
    return window.confirm(
      `Vas a ${action} la fuerza del volante.\n\n` +
        "Este ajuste requiere guardar y reiniciar. Comprueba que el volante está libre y sujeto.\n\n" +
        "¿Continuar?",
    );
  }
  if (field.requiresReboot) {
    return window.confirm(
      `«${field.label}» requiere guardar y reiniciar el volante para aplicarse.\n\n¿Continuar?`,
    );
  }
  return true;
}

/**
 * Escribe el campo y, si el firmware solo lo aplica al reiniciar (fuerza, GPIO,
 * reset Z0...), encadena el comando de guardar y reiniciar.
 */
function useCommitField(): (field: FieldDef, value: number) => void {
  const { setField, runCommand } = useHub();
  return (field, value) => {
    if (!confirmChange(field, value)) return;
    void (async () => {
      try {
        await setField(field.name, value);
        if (field.requiresReboot) await runCommand("save");
      } catch {
        // el toast del contexto ya muestra el error
      }
    })();
  };
}

export function GroupFields({
  group,
  onlyAdvanced = false,
}: {
  group: "effects" | "hardware";
  onlyAdvanced?: boolean;
}): React.ReactElement {
  const { fields, settings, writable } = useHub();
  const commit = useCommitField();

  if (!settings) return <p className="muted">Sin datos del volante.</p>;

  const list = fields.filter(
    (field) => field.group === group && Boolean(field.advanced) === onlyAdvanced && !field.arrayLength,
  );

  return (
    <div className="fields">
      {list.map((field) => {
        const value = valueOf(settings, field);
        if (value === null) return null;
        return (
          <FieldRow
            key={field.name}
            field={field}
            value={value}
            disabled={!writable}
            onCommit={(next) => commit(field, next)}
          />
        );
      })}
    </div>
  );
}

export function SingleField({ name }: { name: string }): React.ReactElement | null {
  const { fields, settings, writable } = useHub();
  const commit = useCommitField();
  const field = fields.find((item) => item.name === name);
  if (!field || !settings) return null;
  const value = valueOf(settings, field);
  if (value === null) return null;
  return (
    <FieldRow
      field={field}
      value={value}
      disabled={!writable}
      onCommit={(next) => commit(field, next)}
    />
  );
}
