import React from "react";
import { Icon } from "../components/Icons";
import { Button } from "../components/ui";
import { useHub } from "../hub";

export function Offline(): React.ReactElement {
  const { bootError } = useHub();
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
        <h1>No se puede conectar con el hub</h1>
        <p>
          {bootError ??
            "Comprueba que el hub está abierto en el PC y que estás en la misma red WiFi."}
        </p>
        <Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
        <p className="muted">
          En el PC: <code>npm start</code> dentro de <code>ffbeast-remote</code>.
        </p>
      </div>
    </div>
  );
}
