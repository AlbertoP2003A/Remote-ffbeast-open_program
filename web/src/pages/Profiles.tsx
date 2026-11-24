import React, { useRef, useState } from "react";
import { useHub } from "../hub";
import type { DeviceSettings, FieldDef, Profile } from "../types";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";

interface ProfileChange {
  label: string;
  from: number;
  to: number;
  requiresReboot: boolean;
}

function fieldValue(
  settings: DeviceSettings,
  field: FieldDef,
  index: number,
): number | undefined {
  if (field.group === "misc") return undefined;
  const bag = settings[field.group] as unknown as Record<string, number | number[]>;
  const value = bag[field.name];
  if (Array.isArray(value)) return value[index];
  return value;
}

/** Diff legible entre lo que hay en el volante y lo que aplicaria el perfil. */
function profileChanges(
  profile: Profile,
  current: DeviceSettings,
  fields: FieldDef[],
): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const field of fields) {
    if (field.group === "misc") continue;
    const count = field.arrayLength ?? 1;
    for (let index = 0; index < count; index += 1) {
      const from = fieldValue(current, field, index);
      const to = fieldValue(profile.deviceSettings, field, index);
      if (from === undefined || to === undefined || from === to) continue;
      changes.push({
        label: field.arrayLength ? `${field.label} ${index + 1}` : field.label,
        from,
        to,
        requiresReboot: Boolean(field.requiresReboot),
      });
    }
  }
  return changes;
}

export function Profiles(): React.ReactElement {
  const {
    profiles,
    settings,
    fields,
    writable,
    createProfile,
    applyProfile,
    deleteProfile,
    exportProfiles,
    importProfiles,
    notify,
  } = useHub();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createProfile(name);
      setName("");
    } catch {
      // el toast ya informa
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, profileName: string): Promise<void> => {
    if (!window.confirm(`¿Borrar el perfil "${profileName}"?`)) return;
    try {
      await deleteProfile(id);
    } catch {
      // el toast ya informa
    }
  };

  const apply = async (profile: Profile): Promise<void> => {
    if (!settings) {
      notify("Conecta el volante antes de aplicar un perfil", "error");
      return;
    }
    const changes = profileChanges(profile, settings, fields);
    const preview = changes
      .slice(0, 12)
      .map(
        (change) =>
          `• ${change.label}: ${change.from} → ${change.to}${
            change.requiresReboot ? " (requiere reiniciar)" : ""
          }`,
      )
      .join("\n");
    const extra =
      changes.length > 12 ? `\n… y ${changes.length - 12} cambios más` : "";
    const restart = changes.some((change) => change.requiresReboot);
    const message =
      changes.length === 0
        ? `El perfil "${profile.name}" no cambia nada respecto al volante actual.\n\n¿Aplicar igualmente?`
        : `¿Aplicar "${profile.name}"?\n\n${preview}${extra}\n\n${
            restart
              ? "El volante se guardará y reiniciará para aplicar los cambios marcados.\n\n"
              : ""
          }¿Continuar?`;

    if (!window.confirm(message)) return;
    try {
      await applyProfile(profile.id);
    } catch {
      // el toast ya informa
    }
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      await importProfiles(data);
    } catch {
      notify("El archivo no es un JSON de perfiles válido", "error");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <>
      <PageHeader
        title="Perfiles"
        subtitle="Guarda, aplica y comparte combinaciones de ajustes."
        actions={
          <>
            <Button variant="ghost" icon="download" onClick={() => void exportProfiles()}>
              Exportar
            </Button>
            <Button variant="ghost" icon="upload" onClick={() => fileRef.current?.click()}>
              Importar
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => void onFile(event)}
            />
          </>
        }
      />

      <Card title="Guardar ajustes actuales">
        <form className="row wrap" onSubmit={(event) => void create(event)}>
          <input
            className="input"
            type="text"
            placeholder="Nombre del perfil (p. ej. GT3)"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            aria-label="Nombre del perfil"
          />
          <Button
            type="submit"
            variant="primary"
            icon="save"
            disabled={!settings || busy || !name.trim()}
          >
            Guardar perfil
          </Button>
        </form>
        <p className="muted">
          Se guardan los valores que el volante tiene ahora mismo
          {settings ? ` (recorrido ${settings.effects.motionRange}°)` : ""}.
        </p>
      </Card>

      <Card title={`Perfiles (${profiles.length})`}>
        {profiles.length === 0 ? (
          <EmptyState icon="profiles" title="Todavía no hay perfiles">
            Configura el volante a tu gusto y guarda el primer perfil.
          </EmptyState>
        ) : (
          <ul className="profile-list">
            {profiles.map((profile) => (
              <li key={profile.id} className="profile-item">
                <div className="profile-info">
                  <strong>{profile.name}</strong>
                  <span>{new Date(profile.createdAt).toLocaleString()}</span>
                </div>
                <div className="row">
                  <Button
                    size="sm"
                    icon="play"
                    disabled={!writable}
                    onClick={() => void apply(profile)}
                  >
                    Aplicar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    aria-label={`Borrar ${profile.name}`}
                    onClick={() => void remove(profile.id, profile.name)}
                  >
                    Borrar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
