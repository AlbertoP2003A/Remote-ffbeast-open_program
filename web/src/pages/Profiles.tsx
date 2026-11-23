import React, { useRef, useState } from "react";
import { useHub } from "../hub";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";

export function Profiles(): React.ReactElement {
  const {
    profiles,
    settings,
    status,
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

  const apply = async (id: string, profileName: string): Promise<void> => {
    if (
      !window.confirm(
        `¿Aplicar "${profileName}" al volante?\n\nSi el perfil incluye fuerza o GPIO, el volante se guardará y reiniciará.`,
      )
    ) {
      return;
    }
    try {
      await applyProfile(id);
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

  const readOnly = Boolean(status?.readOnly);

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
                    disabled={readOnly || !status?.connected}
                    onClick={() => void apply(profile.id, profile.name)}
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
