import React from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "../components/Icons";
import { PageHeader } from "../components/ui";

const ITEMS: Array<{
  to: string;
  icon: IconName;
  title: string;
  description: string;
}> = [
  {
    to: "/monitoring",
    icon: "chart",
    title: "Monitor en vivo",
    description: "Posición y torque de los últimos 30 segundos, con exportación CSV.",
  },
  {
    to: "/pins",
    icon: "chip",
    title: "Pines",
    description: "Modos de los 10 pines, extensión y bus SPI.",
  },
  {
    to: "/buttons",
    icon: "grid",
    title: "Botones",
    description: "Modos de los 32 botones de la extensión.",
  },
  {
    to: "/axes",
    icon: "axis",
    title: "Ejes",
    description: "Zonas muertas, suavizado y umbrales de los 3 ejes ADC.",
  },
  {
    to: "/settings",
    icon: "gear",
    title: "Ajustes",
    description: "Emparejamiento, token, seguridad y diagnóstico.",
  },
];

export function More(): React.ReactElement {
  return (
    <>
      <PageHeader title="Más" subtitle="Todo lo que no cabe en la barra inferior." />
      <div className="tiles">
        {ITEMS.map((item) => (
          <Link key={item.to} to={item.to} className="tile">
            <span className="tile-icon">
              <Icon name={item.icon} size={22} />
            </span>
            <span className="tile-text">
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </span>
            <Icon name="back" size={16} className="tile-arrow" />
          </Link>
        ))}
      </div>
    </>
  );
}
