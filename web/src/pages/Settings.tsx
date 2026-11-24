import React, { useEffect, useState } from "react";
import { apiGet, apiGetBlob, errorMessage } from "../api";
import { ToggleSwitch } from "../components/controls";
import { Badge, Button, Card, PageHeader, Spinner } from "../components/ui";
import { useHub } from "../hub";
import type { Diagnostics } from "../types";
import { displayVersion } from "../version";

function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

export function Settings(): React.ReactElement {
  const {
    session,
    config,
    status,
    updateConfig,
    fetchToken,
    regenerateToken,
    notify,
  } = useHub();
  const [token, setToken] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!session?.loopback) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const [tokenValue, diag, logData, qr] = await Promise.all([
          fetchToken(),
          apiGet<Diagnostics>("/api/diagnostics"),
          apiGet<{ lines: string[] }>("/api/logs?lines=250"),
          apiGet<{ url: string }>("/api/qr/url"),
        ]);
        if (!alive) return;
        setToken(tokenValue);
        setDiagnostics(diag);
        setLogs(logData.lines);
        setQrUrl(qr.url);
      } catch {
        // sin permisos o sin red: se muestra solo lo básico
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session?.loopback, fetchToken]);

  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      notify("Copiado al portapapeles", "success");
    } catch {
      window.prompt("Copia el valor:", value);
    }
  };

  const regenerate = async (): Promise<void> => {
    if (
      !window.confirm(
        "¿Regenerar el token? Los móviles emparejados dejarán de funcionar y tendrás que escanear el QR otra vez.",
      )
    ) {
      return;
    }
    setRegenerating(true);
    try {
      setToken(await regenerateToken());
      setReveal(true);
      try {
        const fresh = await apiGet<{ url: string }>("/api/qr/url");
        setQrUrl(fresh.url);
      } catch {
        // el QR se actualizará al recargar
      }
    } catch {
      // toast
    } finally {
      setRegenerating(false);
    }
  };

  const reloadLogs = async (): Promise<void> => {
    try {
      const data = await apiGet<{ lines: string[] }>("/api/logs?lines=250");
      setLogs(data.lines);
      notify("Registro actualizado", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const downloadDiagnostics = async (): Promise<void> => {
    setDownloading(true);
    try {
      const blob = await apiGetBlob("/api/diagnostics/download");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ffbeast-diagnostics.zip";
      link.click();
      URL.revokeObjectURL(url);
      notify("Diagnóstico descargado", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    } finally {
      setDownloading(false);
    }
  };

  const masked = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : "—";

  return (
    <>
      <PageHeader title="Ajustes" subtitle="Emparejamiento, seguridad y diagnóstico." />

      <div className="grid grid-2">
        <Card title="Este dispositivo">
          <dl className="kv">
            <div>
              <dt>Conexión</dt>
              <dd>{session?.loopback ? "PC (localhost)" : "Red local"}</dd>
            </div>
            <div>
              <dt>Modo</dt>
              <dd>{status?.mock ? "Simulado" : "Volante real"}</dd>
            </div>
            <div>
              <dt>Versión</dt>
              <dd>v{displayVersion(status?.version)}</dd>
            </div>
            <div>
              <dt>Puerto</dt>
              <dd>{config?.port ?? status?.port ?? "—"}</dd>
            </div>
          </dl>
          <div className="row wrap">
            <Badge tone={status?.connected ? "ok" : "warn"} dot>
              {status?.connected ? "Volante conectado" : "Volante desconectado"}
            </Badge>
            {status?.readOnly && <Badge tone="info">Solo lectura</Badge>}
            {session?.loopback && <Badge tone="neutral">Acceso local</Badge>}
          </div>
        </Card>

        <Card title="Seguridad" subtitle="Se aplica a todos los dispositivos.">
          <div className="setting-row">
            <div>
              <strong>Modo solo lectura</strong>
              <p>Bloquea escrituras y comandos. Útil durante una carrera.</p>
            </div>
            <ToggleSwitch
              id="readonly"
              checked={Boolean(config?.readOnly)}
              label="Modo solo lectura"
              disabled={Boolean(config?.readOnly) && !session?.loopback}
              onChange={(next) => void updateConfig({ readOnly: next })}
            />
          </div>

          {config?.readOnly && !session?.loopback && (
            <p className="muted">
              Solo el PC puede desactivar el modo solo lectura. Desde el móvil
              puedes activarlo, pero no deshacerlo.
            </p>
          )}

          {session?.loopback && (
            <div className="setting-row">
              <div>
                <strong>Permitir «Guardar y reiniciar»</strong>
                <p>Si lo desactivas, el comando se rechaza desde cualquier dispositivo.</p>
              </div>
              <ToggleSwitch
                id="allow-save"
                checked={Boolean(config?.allowSaveCommand)}
                label="Permitir guardar y reiniciar"
                onChange={(next) => void updateConfig({ allowSaveCommand: next })}
              />
            </div>
          )}

          {session?.loopback && config?.autostart !== undefined && (
            <div className="setting-row">
              <div>
                <strong>Iniciar con Windows</strong>
                <p>
                  Arranca en la bandeja al iniciar sesión. No requiere
                  administrador.
                </p>
              </div>
              <ToggleSwitch
                id="autostart"
                checked={Boolean(config.autostart)}
                label="Iniciar con Windows"
                onChange={(next) => void updateConfig({ autostart: next })}
              />
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Emparejar un móvil"
        subtitle="El teléfono y el PC tienen que estar en la misma WiFi."
      >
        {session?.loopback ? (
          <div className="pairing">
            <div className="qr-frame">
              <img
                className="qr"
                src="/api/qr"
                width={220}
                height={220}
                alt="Código QR para emparejar el móvil"
              />
            </div>
            <div className="pairing-info">
              <p>Abre la cámara del móvil y escanea este código.</p>
              {qrUrl && <code className="url-box">{qrUrl}</code>}
              <div className="row wrap">
                {qrUrl && (
                  <Button icon="copy" onClick={() => void copy(qrUrl)}>
                    Copiar enlace
                  </Button>
                )}
                <Button variant="ghost" icon="phone" onClick={() => window.open(qrUrl ?? "/", "_blank")}>
                  Abrir aquí
                </Button>
              </div>
              <p className="muted">
                Si cambias de red, vuelve a escanear el QR: la IP puede cambiar.
              </p>
              <p className="muted">
                Android 17: si Chrome muestra «ERR_TOO_MANY_RETRIES», activa el
                permiso «Dispositivos cercanos» para Chrome y vuelve a abrir el
                enlace.
              </p>
            </div>
          </div>
        ) : (
          <p className="muted">
            El QR y el token solo se muestran desde el PC. Abre{" "}
            <code>http://localhost:{config?.port ?? 47100}/</code> en el ordenador.
          </p>
        )}
      </Card>

      {session?.loopback && (
        <Card title="Token de emparejamiento">
          <div className="token-row">
            <code className="token">{reveal ? token ?? "—" : masked}</code>
            <div className="row">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReveal((current) => !current)}
              >
                {reveal ? "Ocultar" : "Mostrar"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="copy"
                disabled={!token}
                onClick={() => token && void copy(token)}
              >
                Copiar
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon="refresh"
                disabled={regenerating}
                onClick={() => void regenerate()}
              >
                Regenerar
              </Button>
            </div>
          </div>
          <p className="muted">
            El token es la única llave de acceso. No lo compartas fuera de tu red.
          </p>
        </Card>
      )}

      <Card title="Diagnóstico" subtitle="Para resolver problemas o pedir ayuda.">
        {loading && <Spinner label="Cargando diagnóstico…" />}
        {diagnostics && (
          <>
            <dl className="kv">
              <div>
                <dt>Versión</dt>
                <dd>{diagnostics.version}</dd>
              </div>
              <div>
                <dt>Tiempo activo</dt>
                <dd>{formatUptime(diagnostics.uptimeSeconds)}</dd>
              </div>
              <div>
                <dt>Firmware</dt>
                <dd>{diagnostics.firmware ?? "—"}</dd>
              </div>
              <div>
                <dt>Datos</dt>
                <dd className="mono">{diagnostics.dataDir}</dd>
              </div>
              <div>
                <dt>Config</dt>
                <dd className="mono">{diagnostics.configPath}</dd>
              </div>
              <div>
                <dt>Red</dt>
                <dd>
                  {diagnostics.lan.length > 0
                    ? diagnostics.lan
                        .slice(0, 4)
                        .map((entry) => `${entry.address} (${entry.iface})`)
                        .join(", ")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>HID</dt>
                <dd>
                  {diagnostics.hid.length > 0
                    ? diagnostics.hid
                        .map((device) => device.product ?? device.path)
                        .join(", ")
                    : "no detectado"}
                </dd>
              </div>
              <div>
                <dt>Salud</dt>
                <dd>
                  {diagnostics.health?.degraded
                    ? `Inestable (${diagnostics.health.consecutiveFailures} fallos seguidos)`
                    : "Correcta"}
                </dd>
              </div>
              <div>
                <dt>Pit House</dt>
                <dd>
                  {diagnostics.conflict?.active
                    ? `Abierto (${diagnostics.conflict.process ?? "proceso"})`
                    : "No detectado"}
                </dd>
              </div>
            </dl>
            <div className="row wrap">
              <Button
                variant="ghost"
                icon="copy"
                onClick={() => void copy(JSON.stringify(diagnostics, null, 2))}
              >
                Copiar diagnóstico
              </Button>
              <Button
                icon="download"
                disabled={downloading}
                onClick={() => void downloadDiagnostics()}
              >
                Descargar ZIP
              </Button>
            </div>
          </>
        )}
      </Card>

      {session?.loopback && (
        <Card
          title="Registro"
          subtitle="Últimas 250 líneas de hub.log"
          actions={
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              onClick={() => void reloadLogs()}
            >
              Recargar
            </Button>
          }
        >
          {logs && logs.length > 0 ? (
            <pre className="logs">{logs.join("\n")}</pre>
          ) : (
            <p className="muted">Sin registros todavía.</p>
          )}
        </Card>
      )}

      <Card title="Acerca de">
        <p className="muted">
          FFBeast Remote no es oficial. La estética está inspirada en FFBeast Pit House
          (MIT). No incluye firmware ni software propietario de FFBeast.
        </p>
        <p className="muted">
          Hub v{displayVersion(status?.version)} · API v1 · datos en{" "}
          <code>%APPDATA%\ffbeast-remote</code>
        </p>
      </Card>
    </>
  );
}
