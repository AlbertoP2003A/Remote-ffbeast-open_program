import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPost,
  clearStoredToken,
  errorMessage,
  getToken,
  setStoredToken,
  wsUrl,
} from "./api";
import { publishLive } from "./live";
import type {
  DeviceSettings,
  FieldDef,
  HubStatus,
  LiveState,
  Profile,
  PublicConfig,
  SessionInfo,
} from "./types";

export type AuthState = "checking" | "ok" | "needs-token" | "offline";
export type WsState = "connecting" | "open" | "closed";
export type NoticeKind = "info" | "success" | "error";

export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
}

export interface HubContextValue {
  authState: AuthState;
  bootError: string | null;
  wsState: WsState;
  /** Volante conectado, sin solo lectura y con el canal en vivo abierto. */
  writable: boolean;
  status: HubStatus | null;
  settings: DeviceSettings | null;
  fields: FieldDef[];
  config: PublicConfig | null;
  profiles: Profile[];
  session: SessionInfo | null;
  notices: Notice[];

  setField(name: string, value: number, index?: number): Promise<void>;
  applySettings(patch: Partial<DeviceSettings>): Promise<void>;
  runCommand(name: string): Promise<void>;
  disableForces(): Promise<void>;
  refreshAll(): Promise<void>;
  refreshProfiles(): Promise<void>;
  createProfile(name: string): Promise<void>;
  applyProfile(id: string): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  exportProfiles(): Promise<void>;
  importProfiles(data: unknown): Promise<void>;
  updateConfig(patch: {
    readOnly?: boolean;
    allowSaveCommand?: boolean;
    autostart?: boolean;
  }): Promise<void>;
  saveToken(token: string): Promise<void>;
  clearToken(): void;
  fetchToken(): Promise<string>;
  regenerateToken(): Promise<string>;
  notify(message: string, kind?: NoticeKind): void;
  dismissNotice(id: number): void;
}

const HubContext = createContext<HubContextValue | null>(null);

const COMMAND_LABELS: Record<string, string> = {
  "reset-center": "Centro restablecido",
  save: "Guardando y reiniciando…",
  reboot: "Reiniciando…",
  dfu: "Entrando en modo DFU…",
};

export function HubProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [bootError, setBootError] = useState<string | null>(null);
  const [wsState, setWsState] = useState<WsState>("connecting");
  const [status, setStatus] = useState<HubStatus | null>(null);
  const [settings, setSettings] = useState<DeviceSettings | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

  const settingsRef = useRef<DeviceSettings | null>(null);
  const fieldsRef = useRef<FieldDef[]>([]);
  const noticeId = useRef(0);

  // Si el WebSocket no esta abierto la UI tiene estado viejo: para seguridad
  // no permitimos escribir hasta recuperar el canal en vivo.
  const writable = Boolean(
    status?.connected &&
      !status.readOnly &&
      wsState === "open" &&
      !status.health?.degraded,
  );

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  const notify = useCallback((message: string, kind: NoticeKind = "info") => {
    const id = (noticeId.current += 1);
    setNotices((current) => [...current.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, 5000);
  }, []);

  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const handleUnauthorized = useCallback((error: unknown): boolean => {
    if (error instanceof ApiError && error.status === 401) {
      setAuthState("needs-token");
      return true;
    }
    return false;
  }, []);

  const bootstrap = useCallback(async () => {
    setAuthState("checking");
    setBootError(null);
    try {
      // En localhost esto siembra la cookie de sesion; en el movil es inocuo.
      await apiGet<{ ok: boolean }>("/api/health").catch(() => undefined);
      const statusRes = await apiGet<{ status: HubStatus }>("/api/status");
      const [settingsRes, configRes, profilesRes, sessionRes] = await Promise.all([
        apiGet<{ settings: DeviceSettings | null; fields: FieldDef[]; connected: boolean }>(
          "/api/settings",
        ),
        apiGet<{ config: PublicConfig }>("/api/config"),
        apiGet<{ profiles: Profile[] }>("/api/profiles"),
        apiGet<SessionInfo>("/api/session"),
      ]);
      setStatus(statusRes.status);
      setSettings(settingsRes.settings);
      setFields(settingsRes.fields);
      setConfig(configRes.config);
      setProfiles(profilesRes.profiles);
      setSession(sessionRes);
      setAuthState("ok");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthState("needs-token");
        setBootError(getToken() ? "Token inválido o caducado." : null);
      } else {
        setBootError(errorMessage(error));
        setAuthState("offline");
      }
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Estado en vivo por WebSocket, con reconexion y backoff.
  useEffect(() => {
    if (authState !== "ok") return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let attempts = 0;

    const connect = (): void => {
      if (disposed) return;
      setWsState("connecting");
      socket = new WebSocket(wsUrl());
      socket.onopen = () => {
        attempts = 0;
        setWsState("open");
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type: string; data: unknown };
          switch (message.type) {
            case "status":
              setStatus(message.data as HubStatus);
              break;
            case "settings":
              setSettings((message.data as { settings: DeviceSettings }).settings);
              break;
            case "fields":
              setFields((message.data as { fields: FieldDef[] }).fields);
              break;
            case "state":
              publishLive(message.data as LiveState);
              break;
            case "safety": {
              const info = message.data as { ok?: boolean; message?: string };
              if (info.message) notify(info.message, info.ok ? "success" : "error");
              break;
            }
            case "error":
              notify((message.data as { message: string }).message, "error");
              break;
            default:
              break;
          }
        } catch {
          // mensaje no JSON: se ignora
        }
      };
      socket.onclose = () => {
        setWsState("closed");
        publishLive(null);
        if (disposed) return;
        // Si el cierre se debe a que el token ya no vale, pasamos a emparejar.
        void apiGet<SessionInfo>("/api/session").catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 401) setAuthState("needs-token");
        });
        attempts += 1;
        const delay = Math.min(8000, 400 * 2 ** Math.min(attempts, 5));
        timer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => {
        try {
          socket?.close();
        } catch {
          // nada
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // nada
      }
    };
  }, [authState, notify]);

  useEffect(() => {
    if (status && !status.connected) publishLive(null);
  }, [status]);

  const setField = useCallback(
    async (name: string, value: number, index = 0) => {
      const previous = settingsRef.current;
      const def = fieldsRef.current.find((field) => field.name === name);
      if (previous && def && def.group !== "misc") {
        setSettings(withValue(previous, def, value, index));
      }
      try {
        const res = await apiPost<{ settings: DeviceSettings }>("/api/settings", {
          field: name,
          value,
          index,
        });
        setSettings(res.settings);
      } catch (error) {
        if (previous) setSettings(previous);
        if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
        throw error;
      }
    },
    [handleUnauthorized, notify],
  );

  const runCommand = useCallback(
    async (name: string) => {
      try {
        await apiPost("/api/command", { name });
        notify(COMMAND_LABELS[name] ?? "Comando enviado", "success");
      } catch (error) {
        if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
        throw error;
      }
    },
    [handleUnauthorized, notify],
  );

  const disableForces = useCallback(async () => {
    try {
      const res = await apiPost<{ settings: DeviceSettings; restarting: boolean }>(
        "/api/safety/disable-forces",
      );
      setSettings(res.settings);
      notify("Fuerzas desactivadas. Guardando y reiniciando el volante…", "success");
    } catch (error) {
      if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
      throw error;
    }
  }, [handleUnauthorized, notify]);

  const applySettings = useCallback(
    async (patch: Partial<DeviceSettings>) => {
      try {
        const res = await apiPost<{
          settings: DeviceSettings;
          restartRequired?: boolean;
        }>("/api/settings/apply", { settings: patch });
        setSettings(res.settings);
        notify("Ajustes aplicados", "success");
        if (res.restartRequired) {
          notify("Hay ajustes que requieren reiniciar; guardando…", "info");
          await runCommand("save");
        }
      } catch (error) {
        if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
        throw error;
      }
    },
    [handleUnauthorized, notify, runCommand],
  );

  const refreshAll = useCallback(async () => {
    try {
      const res = await apiGet<{
        settings: DeviceSettings | null;
        fields: FieldDef[];
        connected: boolean;
      }>("/api/settings");
      setSettings(res.settings);
      setFields(res.fields);
      const statusRes = await apiGet<{ status: HubStatus }>("/api/status");
      setStatus(statusRes.status);
      notify("Ajustes releídos del volante", "success");
    } catch (error) {
      if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
    }
  }, [handleUnauthorized, notify]);

  const refreshProfiles = useCallback(async () => {
    try {
      const res = await apiGet<{ profiles: Profile[] }>("/api/profiles");
      setProfiles(res.profiles);
    } catch (error) {
      if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
    }
  }, [handleUnauthorized, notify]);

  const createProfile = useCallback(
    async (name: string) => {
      try {
        const res = await apiPost<{ profile: Profile }>("/api/profiles", { name });
        setProfiles((current) => [res.profile, ...current]);
        notify("Perfil guardado", "success");
      } catch (error) {
        if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
        throw error;
      }
    },
    [handleUnauthorized, notify],
  );

  const applyProfile = useCallback(
    async (id: string) => {
      try {
        const res = await apiPost<{
          settings: DeviceSettings;
          restartRequired?: boolean;
        }>("/api/profiles/apply", { id });
        setSettings(res.settings);
        notify("Perfil aplicado", "success");
        if (res.restartRequired) {
          notify("El perfil incluye ajustes que requieren reiniciar; guardando…", "info");
          await runCommand("save");
        }
      } catch (error) {
        if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
        throw error;
      }
    },
    [handleUnauthorized, notify, runCommand],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      try {
        await apiDelete(`/api/profiles/${encodeURIComponent(id)}`);
        setProfiles((current) => current.filter((profile) => profile.id !== id));
        notify("Perfil borrado", "success");
      } catch (error) {
        if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
        throw error;
      }
    },
    [handleUnauthorized, notify],
  );

  const exportProfiles = useCallback(async () => {
    try {
      const data = await apiGet<{ version: number; profiles: Profile[] }>("/api/profiles/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ffbeast-perfiles-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
    }
  }, [handleUnauthorized, notify]);

  const importProfiles = useCallback(
    async (data: unknown) => {
      try {
        const res = await apiPost<{ imported: number }>("/api/profiles/import", data);
        await refreshProfiles();
        notify(`${res.imported} perfil(es) importados`, "success");
      } catch (error) {
        if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
        throw error;
      }
    },
    [handleUnauthorized, notify, refreshProfiles],
  );

  const updateConfig = useCallback(
    async (patch: {
      readOnly?: boolean;
      allowSaveCommand?: boolean;
      autostart?: boolean;
    }) => {
      try {
        const res = await apiPost<{ config: PublicConfig }>("/api/config", patch);
        setConfig(res.config);
        setStatus((current) =>
          current ? { ...current, readOnly: res.config.readOnly } : current,
        );
        notify("Configuración guardada", "success");
      } catch (error) {
        if (!handleUnauthorized(error)) notify(errorMessage(error), "error");
        throw error;
      }
    },
    [handleUnauthorized, notify],
  );

  const saveToken = useCallback(
    async (value: string) => {
      setStoredToken(value.trim());
      await bootstrap();
    },
    [bootstrap],
  );

  const clearToken = useCallback(() => {
    clearStoredToken();
    setAuthState("needs-token");
  }, []);

  const fetchToken = useCallback(async () => {
    const res = await apiGet<{ token: string }>("/api/token");
    return res.token;
  }, []);

  const regenerateToken = useCallback(async () => {
    const res = await apiPost<{ token: string }>("/api/token/regenerate");
    setStoredToken(res.token);
    notify("Token regenerado: vuelve a emparejar los móviles", "success");
    return res.token;
  }, [notify]);

  const value = useMemo<HubContextValue>(
    () => ({
      authState,
      bootError,
      wsState,
      writable,
      status,
      settings,
      fields,
      config,
      profiles,
      session,
      notices,
      setField,
      applySettings,
      runCommand,
      disableForces,
      refreshAll,
      refreshProfiles,
      createProfile,
      applyProfile,
      deleteProfile,
      exportProfiles,
      importProfiles,
      updateConfig,
      saveToken,
      clearToken,
      fetchToken,
      regenerateToken,
      notify,
      dismissNotice,
    }),
    [
      authState,
      bootError,
      wsState,
      writable,
      status,
      settings,
      fields,
      config,
      profiles,
      session,
      notices,
      setField,
      applySettings,
      runCommand,
      disableForces,
      refreshAll,
      refreshProfiles,
      createProfile,
      applyProfile,
      deleteProfile,
      exportProfiles,
      importProfiles,
      updateConfig,
      saveToken,
      clearToken,
      fetchToken,
      regenerateToken,
      notify,
      dismissNotice,
    ],
  );

  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
}

export function useHub(): HubContextValue {
  const context = useContext(HubContext);
  if (!context) throw new Error("useHub debe usarse dentro de HubProvider");
  return context;
}

function withValue(
  settings: DeviceSettings,
  def: FieldDef,
  value: number,
  index: number,
): DeviceSettings {
  if (def.group === "misc") return settings;
  const group = def.group;
  const bag = settings[group] as unknown as Record<string, number | number[]>;
  const next = { ...bag };
  const current = next[def.name];
  if (Array.isArray(current)) {
    const array = [...current];
    array[index] = value;
    next[def.name] = array;
  } else {
    next[def.name] = value;
  }
  return { ...settings, [group]: next } as DeviceSettings;
}
