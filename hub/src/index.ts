#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { VERSION, appDataDir, loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { NodeHidFactory } from "./hid/transport.js";
import { MockFactory } from "./hid/mock.js";
import { JoystickDevice, MockJoystick } from "./hid/joystick.js";
import { WheelDevice } from "./hid/driver.js";
import { ProfileStore } from "./domain/profiles.js";
import { ConflictMonitor } from "./domain/conflict.js";
import { Auth } from "./server/auth.js";
import { createHubServer } from "./server/http.js";
import { lanAddresses, mobileUrl } from "./server/net.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../web/dist");

async function main(): Promise<void> {
  process.title = "FFBeast Remote";
  const config = loadConfig();
  const dataDir = appDataDir();
  const log = createLogger({ dir: dataDir, level: config.logLevel });

  const factory = config.mock ? new MockFactory() : new NodeHidFactory();
  const device = new WheelDevice({
    factory,
    config,
    log: log.child("hid"),
  });
  const joystick = config.mock
    ? new MockJoystick()
    : new JoystickDevice(log.child("joystick"));
  const profiles = new ProfileStore(dataDir, log);
  const conflict = new ConflictMonitor({
    processes: config.conflictProcesses,
    log: log.child("conflict"),
  });
  conflict.start();
  const auth = new Auth(config.token);

  device.on("connected", () => log.info("Volante conectado"));
  device.on("disconnected", () => log.warn("Volante desconectado"));
  device.on("license", (license) => {
    log.info(
      `Firmware ${license.major}.${license.minor}.${license.patch} (${license.isRegistered ? "PRO" : "Free"})`,
    );
  });
  device.on("error", (error: Error) => log.error("Error del volante", error));

  device.start();
  joystick.start();

  const hub = createHubServer({
    config,
    auth,
    device,
    joystick,
    profiles,
    conflict,
    log: log.child("http"),
    webRoot,
    startedAt: Date.now(),
  });

  let port: number;
  try {
    port = await hub.listen(config.port, "0.0.0.0");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(
      `No se pudo abrir el puerto ${config.port}: ${message}. ` +
        "Cierra la otra instancia o cambia 'port' en config.json.",
    );
    await device.stop();
    joystick.stop();
    conflict.stop();
    process.exit(1);
  }

  printBanner(port, config.mock, auth.current);
  if (!fs.existsSync(path.join(webRoot, "index.html"))) {
    log.warn(`La UI no está compilada (${webRoot}). Ejecuta: npm run build`);
  }

  if (process.env.FFBEAST_OPEN === "1") openBrowser(`http://localhost:${port}/`);

  let closing = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (closing) return;
    closing = true;
    log.info(`Cerrando hub (${reason})`);
    await device.stop();
    joystick.stop();
    conflict.stop();
    await hub.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (error) => log.error("Promesa rechazada sin capturar", error));
  process.on("uncaughtException", (error) => log.error("Excepción no capturada", error));
}

function printBanner(port: number, mock: boolean, token: string): void {
  const addresses = lanAddresses();
  const lan = addresses[0]?.address ?? null;
  const mobile = mobileUrl(port, token, lan);
  const line = "=".repeat(64);
  console.log(`\n${line}`);
  console.log(` FFBeast Remote ${VERSION}${mock ? "  ·  MODO SIMULADO" : ""}`);
  console.log(line);
  console.log(` PC:     http://localhost:${port}/`);
  console.log(` Móvil:  ${mobile}`);
  console.log(` Datos:  ${appDataDir()}`);
  if (!lan) {
    console.log(" Aviso:  no se ha detectado una IP de LAN. Conecta el PC a WiFi/Ethernet.");
  } else if (addresses.length > 1) {
    console.log(" Otras IPs de este PC:");
    for (const entry of addresses.slice(1, 5)) {
      console.log(`   - ${entry.address} (${entry.iface})`);
    }
  }
  if (mock) {
    console.log(" Simulación: los cambios no llegan a ningún volante real.");
  }
  console.log(`${line}\n`);
  console.log(" Escanea este QR desde el móvil (misma red WiFi):\n");
  void QRCode.toString(mobile, { type: "terminal", small: true })
    .then((qr) => console.log(qr))
    .catch(() => console.log(` (No se pudo dibujar el QR. Abre esta URL en el móvil: ${mobile})`));
  console.log(" Firewall: permite TCP " + port + " en red privada (scripts/firewall.ps1).\n");
}

function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // abrir el navegador es opcional
  }
}

main().catch((error: unknown) => {
  console.error("FFBeast Remote no pudo arrancar:", error);
  process.exit(1);
});
