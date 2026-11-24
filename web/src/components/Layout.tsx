import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useHub } from "../hub";
import { Icon, type IconName } from "./Icons";
import { Badge, Banner, Button } from "./ui";
import { ToastHost } from "./ToastHost";
import { displayVersion } from "../version";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  phase2?: boolean;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard", end: true },
  { to: "/effects", label: "Efectos", icon: "effects" },
  { to: "/hardware", label: "Hardware", icon: "hardware" },
  { to: "/profiles", label: "Perfiles", icon: "profiles" },
  { to: "/monitoring", label: "Monitor", icon: "chart" },
  { to: "/pins", label: "Pines", icon: "chip" },
  { to: "/buttons", label: "Botones", icon: "grid" },
  { to: "/axes", label: "Ejes", icon: "axis" },
  { to: "/settings", label: "Ajustes", icon: "gear" },
];

const BOTTOM: NavItem[] = [
  { to: "/", label: "Inicio", icon: "dashboard", end: true },
  { to: "/effects", label: "Efectos", icon: "effects" },
  { to: "/hardware", label: "Hardware", icon: "hardware" },
  { to: "/profiles", label: "Perfiles", icon: "profiles" },
  { to: "/more", label: "Más", icon: "more" },
];

function ConnectionBadge(): React.ReactElement {
  const { wsState, status } = useHub();
  if (wsState !== "open") return <Badge tone="danger" dot>Sin hub</Badge>;
  if (!status?.connected) return <Badge tone="warn" dot>Sin volante</Badge>;
  return <Badge tone="ok" dot>En línea</Badge>;
}

function ConnectionStrip(): React.ReactElement | null {
  const { wsState, status, refreshAll } = useHub();
  const banners: React.ReactNode[] = [];

  if (wsState !== "open") {
    banners.push(
      <Banner key="hub" tone="warn" icon="refresh" title="Reconectando con el hub…">
        Comprueba que el PC sigue encendido, con el hub abierto y en la misma WiFi.
      </Banner>,
    );
  } else if (status && !status.connected) {
    banners.push(
      <Banner
        key="wheel"
        tone="warn"
        icon="alert"
        title="Volante no detectado"
        action={
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void refreshAll()}>
            Reintentar
          </Button>
        }
      >
        Conéctalo por USB: el hub lo detecta solo en 1-2 segundos.
      </Banner>,
    );
  }

  if (status?.health?.degraded) {
    banners.push(
      <Banner
        key="health"
        tone="danger"
        icon="alert"
        title="Volante inestable"
        action={
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void refreshAll()}>
            Releer ajustes
          </Button>
        }
      >
        {status.health.consecutiveFailures} fallos seguidos de lectura/escritura.
        {status.health.lastError ? ` Último error: ${status.health.lastError}` : ""}
        {" "}Las escrituras están bloqueadas hasta releer.
      </Banner>,
    );
  }

  if (status?.conflict?.active) {
    banners.push(
      <Banner key="conflict" tone="danger" icon="alert" title="Pit House abierto">
        Se ha detectado {status.conflict.process}. Cierra Pit House o este hub
        para evitar que dos programas escriban en el volante a la vez.
      </Banner>,
    );
  }

  if (status?.readOnly) {
    banners.push(
      <Banner key="readonly" tone="info" icon="check" title="Modo solo lectura">
        Puedes ver el estado, pero las escrituras están bloqueadas.
      </Banner>,
    );
  }

  if (status?.mock) {
    banners.push(
      <Banner key="mock" tone="accent" icon="alert" title="Modo simulado">
        Los cambios no llegan a un volante real.
      </Banner>,
    );
  }

  if (banners.length === 0) return null;
  return <div className="strips">{banners}</div>;
}

export function Layout({ children }: { children: React.ReactNode }): React.ReactElement {
  const { status, settings } = useHub();
  const location = useLocation();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="wheel" size={22} />
          </span>
          <div className="brand-text">
            <strong>FFBeast</strong>
            <span>Remote</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Principal">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.phase2 && <em>F2</em>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <ConnectionBadge />
          <span className="version">v{displayVersion(status?.version)}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-brand">
            <Icon name="wheel" size={20} />
            <span>FFBeast Remote</span>
          </div>
          <div className="topbar-status">
            {settings && (
              <Badge tone={settings.hardware.forceEnabled ? "accent" : "neutral"} dot>
                Fuerza {settings.hardware.forceEnabled ? "ON" : "OFF"}
              </Badge>
            )}
            {status?.firmware && <Badge tone="neutral">FW {status.firmware}</Badge>}
            {status?.license && (
              <Badge tone={status.license.isRegistered ? "ok" : "neutral"}>
                {status.license.isRegistered ? "PRO" : "Free"}
              </Badge>
            )}
            <ConnectionBadge />
          </div>
        </header>

        <ConnectionStrip />
        <main className="content">
          <div className="page" key={location.pathname}>
            {children}
          </div>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Navegación principal">
        {BOTTOM.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `bottom-link${isActive ? " is-active" : ""}`}
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <ToastHost />
    </div>
  );
}
