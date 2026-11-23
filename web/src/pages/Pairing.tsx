import React, { useState } from "react";
import { Icon } from "../components/Icons";
import { Button } from "../components/ui";
import { useHub } from "../hub";

export function Pairing(): React.ReactElement {
  const { saveToken, bootError } = useHub();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      await saveToken(value);
    } catch {
      // bootError se muestra debajo
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <span className="brand-mark">
            <Icon name="wheel" size={26} />
          </span>
          <div>
            <strong>FFBeast</strong>
            <span>Remote</span>
          </div>
        </div>

        <h1>Emparejar este dispositivo</h1>
        <p>
          Escanea el QR que muestra el hub en el PC o pega aquí el token de
          emparejamiento.
        </p>

        <form className="gate-form" onSubmit={(event) => void submit(event)}>
          <input
            className="input"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Token de emparejamiento"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-label="Token de emparejamiento"
          />
          <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
            {busy ? "Comprobando…" : "Entrar"}
          </Button>
        </form>

        {bootError && <p className="form-error">{bootError}</p>}

        <details className="gate-help">
          <summary>¿Dónde está el token?</summary>
          <p>
            En el PC, abre <code>http://localhost:47100/</code> y entra en{" "}
            <strong>Ajustes</strong>. También aparece en la consola del hub y en{" "}
            <code>%APPDATA%\ffbeast-remote\config.json</code>.
          </p>
        </details>
      </div>
    </div>
  );
}
