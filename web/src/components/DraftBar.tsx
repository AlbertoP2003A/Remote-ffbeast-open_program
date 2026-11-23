import React from "react";
import { Button } from "./ui";

export function DraftBar({
  changes,
  busy,
  disabled,
  onDiscard,
  onApply,
}: {
  changes: number;
  busy: boolean;
  disabled: boolean;
  onDiscard: () => void;
  onApply: () => void;
}): React.ReactElement | null {
  if (changes === 0) return null;
  return (
    <div className="draft-bar" role="status">
      <div className="draft-info">
        <strong>
          {changes} cambio{changes === 1 ? "" : "s"} sin aplicar
        </strong>
        <span>Se guardará y reiniciará el volante para aplicarlos.</span>
      </div>
      <div className="draft-actions">
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={busy}>
          Descartar
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon="save"
          onClick={onApply}
          disabled={busy || disabled}
        >
          {busy ? "Aplicando…" : "Aplicar y reiniciar"}
        </Button>
      </div>
    </div>
  );
}
