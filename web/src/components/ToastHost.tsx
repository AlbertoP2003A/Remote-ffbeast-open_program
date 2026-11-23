import React from "react";
import { useHub } from "../hub";

export function ToastHost(): React.ReactElement | null {
  const { notices, dismissNotice } = useHub();
  if (notices.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={`toast toast-${notice.kind}`}>
          <span>{notice.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Cerrar aviso"
            onClick={() => dismissNotice(notice.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
