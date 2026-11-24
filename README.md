# FFBeast Remote

Control del volante **FFBeast** desde el PC y desde el móvil, sin depender de
Pit House.

El PC ejecuta un **hub** que es el único que habla USB HID con el volante y
publica una API HTTP/WebSocket. La interfaz es una **PWA** servida por ese mismo
hub: la misma en el navegador del PC y en el teléfono.

Hay dos implementaciones del hub, con la misma API, configuración y perfiles:

- **Rust** (`hub-rs/`): recomendada. Un único `.exe` con la PWA embebida, sin
  Node ni consola, con bandeja del sistema e instalador.
- **Node** (`hub/`): referencia y entorno de desarrollo.

> Proyecto no oficial. No incluye firmware ni software propietario de FFBeast.

## Estado

MVP completo (M0–M5 y M7) probado con hardware real (FFBeast 26.1.1 PRO) y con
el dispositivo simulado:

- Detección y reconexión automática del volante.
- Lectura de Effects, Hardware, GPIO, ADC y licencia.
- Escritura con **read-back** y errores claros.
- Estado en vivo por WebSocket a 20 Hz, incluidos los ejes del joystick.
- Perfiles JSON (crear, aplicar, borrar, importar/exportar).
- **Pines**: 10 pines con sus modos, extensión y bus SPI.
- **Botones**: matriz de 32 botones con modos y edición por lotes.
- **Ejes**: 3 ejes ADC con zonas muertas, suavizado y umbrales.
- **Pedales**: lectura en vivo de los 3 ejes del joystick y calibración local.
- **Monitor**: gráfica de posición/torque de 30 s, pausa y exportación CSV.
- **Dynamic dampening** (Effects, offset 14) para firmware 24.1.5+ y licencia PRO.
- Token, QR, rate limit, modo solo lectura, diagnóstico ZIP y registro.
- Hub Rust autónomo con **bandeja**, autostart e **instalador por usuario**.
- UI responsive con estética oscura tipo Pit House.

Pendiente (fases siguientes): validación prolongada de estabilidad USB (M6),
firma de código y auto-actualización.

## Requisitos

- Windows 10/11 x64.
- **Node.js 22 LTS** (o 24 LTS) solo para el hub Node y el desarrollo. El
  instalador y el paquete portable no lo necesitan. Node 20 ya no tiene soporte.
- Para compilar el hub Rust: Rust estable (toolchain GNU en Windows), binutils
  (`windres`/`dlltool`) e Inno Setup 6 si vas a generar el instalador. No hace
  falta para usar el `.exe` ni el instalador ya compilados.
- El volante conectado por USB al PC.
- Para el móvil: misma red WiFi que el PC.

## Instalación y arranque

Para uso normal, usa el **instalador** o el **paquete portable** (más abajo).
Las instrucciones siguientes arrancan el hub Node desde el código, útil para
desarrollo:

### Desde el código (hub Node)

```bash
cd ffbeast-remote
npm install
npm run build
npm start
```

La primera vez se crea `%APPDATA%\ffbeast-remote\config.json` con un token
aleatorio. Al arrancar verás en la consola:

```
 PC:     http://localhost:47100/
 Móvil:  http://192.168.x.x:47100/m?t=...
```

y un **QR** para escanear con el móvil.

### Instalador para Windows (recomendado)

El hub Rust se distribuye como instalador **por usuario**, sin administrador:

```
dist\FFBeastRemote-Setup-1.0.0.exe
```

- Instala en `%LOCALAPPDATA%\FFBeast Remote` y crea accesos directos en Inicio
  (y en el escritorio, opcional).
- No abre consola: arranca en la **bandeja** y abre la UI en el navegador. Si ya
  hay una instancia, el acceso directo solo abre la interfaz existente.
- El **token** y el **QR** para el móvil están en **Ajustes → Emparejar un móvil**.
- **Iniciar con Windows** opcional: desmarcado en una instalación nueva y se
  conserva tal cual al actualizar.
- **Firewall** opcional para el móvil: crea una regla por programa para
  `ffbeast-hub.exe` en redes privadas. Pide UAC una sola vez.
- El desinstalador cierra el hub, quita su autostart y la regla de firewall, y
  pregunta si quieres borrar también los perfiles y la configuración.
- No está firmado: SmartScreen mostrará un aviso. Usa **Más información →
  Ejecutar de todas formas**. La firma llegará cuando haya certificado.

Para generarlo (web + Rust + Inno Setup 6):

```powershell
npm run installer
# o: powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
```

El instalador y su SHA-256 quedan en `dist\`.

### Paquete portable

Alternativa sin instalación: `hub-rs\target\ffbeast-hub-1.0.0-win64.zip`
contiene `ffbeast-hub.exe`, `start.cmd`, `firewall.ps1`, `README.txt` y
`LICENSE`. El `.exe` es autónomo (PWA embebida) y comparte configuración con el
instalador.

Para compilarlo desde el código: `npm run build -w @ffbeast/web` y luego
`cd hub-rs && cargo build --release --bin ffbeast-hub`. Los detalles de
toolchain y del paquete están en `hub-rs/README.md`.

### Sin volante (modo simulado)

```bash
npm run start:mock
```

El hub emula el volante (firmware 26.1.1 PRO, posición y torque animados) para
desarrollar la UI. Los cambios no salen del proceso.

### Desarrollo

```bash
npm run dev          # hub + Vite con recarga
# abre http://localhost:5173 (proxy /api -> 47100)
```

Con hardware simulado:

```bash
npm run dev:mock
```

### Variables de entorno

| Variable              | Efecto                                        |
| --------------------- | --------------------------------------------- |
| `FFBEAST_PORT`        | Puerto HTTP (por defecto 47100)               |
| `FFBEAST_TOKEN`       | Fija el token; si no, se genera uno aleatorio |
| `FFBEAST_MOCK=1`      | Usa el volante simulado                       |
| `FFBEAST_READ_ONLY=1` | Arranca en solo lectura                       |
| `FFBEAST_DATA_DIR`    | Cambia la carpeta de datos                    |
| `FFBEAST_STATE_HZ`    | Frecuencia del estado en vivo (1–60)          |
| `FFBEAST_LOG_LEVEL`   | `debug`, `info`, `warn`, `error`              |
| `FFBEAST_OPEN=1`      | Abre el navegador al arrancar (solo hub Node) |

El hub Rust acepta las mismas opciones como argumentos: `--port`, `--mock`,
`--read-only`, `--state-hz`, `--log-level`, `--data-dir`, además de `--open`,
`--no-tray`, `--web-root`, `--quiet`, `--install-autostart` y
`--uninstall-autostart`. Usa `ffbeast-hub.exe --help` para verlas todas.

## Uso desde el móvil

1. PC y móvil en la **misma WiFi**.
2. En el PC, abre `http://localhost:47100/` y entra en **Ajustes → Emparejar un móvil**.
3. Escanea el QR o abre la URL `http://<IP>:47100/m?t=<token>`.
4. En el móvil, usa **Añadir a pantalla de inicio** para tenerlo como acceso directo.

> **Android 17 + Chrome:** si al abrir una IP local aparece
> `ERR_TOO_MANY_RETRIES`, concede a Chrome el permiso **Dispositivos cercanos**
> (Ajustes → Aplicaciones → Chrome → Permisos → Dispositivos cercanos →
> Permitir). Es un requisito nuevo de Android 17 para acceder a la red local.
> Si ya estaba permitido, quítalo y vuelve a darlo. Firefox para Android no
> necesita este paso.

Si el móvil no conecta:

- Windows debe tener la red como **Privada**, no Pública.
- Permite el puerto una vez (PowerShell como administrador):

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1
  ```

  Si usaste el instalador, la tarea de firewall ya crea la regla por programa;
  para repetirla usa `%LOCALAPPDATA%\FFBeast Remote\firewall.ps1` (acepta
  `-Remove`).

- Evita redes de invitados con aislamiento de clientes y VPNs que separen rutas.
- Si cambia la IP del PC, vuelve a escanear el QR.

> Nota: sobre `http://` la PWA no puede registrar service worker, así que el
> “instalar” de Android crea un acceso directo, no una WebAPK. En iOS se abre en
> modo `standalone`. Para una PWA instalable de verdad haría falta HTTPS con un
> certificado de confianza.

## Arranque automático con Windows

```powershell
# sin admin: tarea al iniciar sesión, sin ventana de consola
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1

# desinstalar
powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1
```

La tarea ejecuta `scripts\start-hidden.vbs`, que arranca
`node hub\dist\index.js` de forma oculta.

El **hub Rust** no usa esta tarea: guarda el autostart en
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (sin admin) y se controla
desde la bandeja, desde **Ajustes → Seguridad** o con
`ffbeast-hub.exe --install-autostart` / `--uninstall-autostart`. El instalador
también elimina la tarea antigua `FFBeastRemote` del hub Node si existe.

## Estructura

```
ffbeast-remote/
├─ hub/                  # proceso Node: HID + HTTP + WebSocket
│  ├─ src/
│  │  ├─ index.ts        # arranque y banner/QR
│  │  ├─ config.ts       # %APPDATA%\ffbeast-remote\config.json
│  │  ├─ log.ts          # logs con rotación (1 MB × 3)
│  │  ├─ hid/
│  │  │  ├─ constants.ts # VID/PID, report ids, tipos de datos
│  │  │  ├─ types.ts     # ajustes, estado, licencia, config
│  │  │  ├─ fields.ts    # registro de campos + offsets de lectura
│  │  │  ├─ codec.ts     # encode/decode puro (testeable)
│  │  │  ├─ transport.ts # node-hid (carga perezosa)
│  │  │  ├─ mock.ts      # volante simulado
│  │  │  └─ driver.ts    # WheelDevice: reconexión, read-back, comandos
│  │  ├─ domain/
│  │  │  ├─ profiles.ts
│  │  │  ├─ compatibility.ts
│  │  │  └─ conflict.ts  # aviso si Pit House está abierto
│  │  └─ server/
│  │     ├─ http.ts      # API + estáticos
│  │     ├─ ws.ts        # estado en vivo
│  │     ├─ auth.ts      # token timing-safe + rate limit
│  │     ├─ headers.ts   # CSP y cabeceras de seguridad
│  │     ├─ net.ts       # elección de IP de LAN
│  │     └─ static.ts    # PWA con fallback SPA
│  └─ test/              # códec, auth, seguridad y API (54 tests)
├─ web/                  # PWA React + Vite
│  ├─ src/pages/         # Dashboard, Efectos, Hardware, Pines, Botones, Ejes,
│  │                     # Monitor, Perfiles, Más, Ajustes
│  ├─ src/components/    # Layout, controles, gauge, gráfica, pedales, toasts
│  ├─ src/hub.tsx        # contexto: API + WebSocket + acciones
│  ├─ src/live.ts        # estado en vivo aislado de React
│  └─ public/            # manifest e iconos
├─ hub-rs/               # hub Rust + PWA embebida (exe autónomo)
│  ├─ src/hid/           # códec, campos y driver HID nativo
│  ├─ src/server/        # API axum, auth, WebSocket y estáticos
│  ├─ src/tray.rs        # bandeja del sistema
│  └─ src/startup.rs     # autostart en HKCU (sin admin)
├─ installer/            # script de Inno Setup 6 y firewall del instalador
├─ dist/                 # instalador compilado y su SHA-256
└─ scripts/              # firewall, autostart, iconos, build-installer
```

## API

Base: `http://<host>:47100`. Autenticación por `Authorization: Bearer <token>`,
`?t=<token>` o cookie HttpOnly (solo localhost). También existe el alias
`/api/v1/...`.

| Método   | Ruta                               | Descripción                                                           |
| -------- | ---------------------------------- | --------------------------------------------------------------------- |
| GET      | `/api/health`                      | Sin auth; en localhost siembra la cookie de sesión                    |
| GET      | `/api/status`                      | Conexión, firmware, licencia, modo                                    |
| GET      | `/api/session`                     | `authenticated`, `loopback` y `readOnly`                              |
| GET      | `/api/fields`                      | Metadatos de los campos de ajustes                                    |
| GET      | `/api/settings`                    | Ajustes + metadatos de campos                                         |
| POST     | `/api/settings`                    | `{ field, index?, value }` (nombre o ID)                              |
| POST     | `/api/settings/apply`              | Aplica un bloque o perfil                                             |
| GET      | `/api/state`                       | Última posición/torque y ejes del joystick                            |
| POST     | `/api/safety/disable-forces`       | Desactiva la fuerza y guarda/reinicia (solo si `save` está permitido) |
| POST     | `/api/command`                     | `reset-center`, `save`, `reboot`, `dfu`                               |
| GET/POST | `/api/profiles`                    | Lista / crea                                                          |
| POST     | `/api/profiles/apply`              | Aplica `{ id }`                                                       |
| DELETE   | `/api/profiles/:id`                | Borra                                                                 |
| GET/POST | `/api/profiles/export` · `/import` | Exporta / importa JSON                                                |
| GET/POST | `/api/config`                      | Configuración pública: solo lectura, comandos y autostart (Rust)      |
| GET      | `/api/token`                       | Solo localhost                                                        |
| POST     | `/api/token/regenerate`            | Solo localhost                                                        |
| GET      | `/api/qr` · `/api/qr/url`          | Solo localhost                                                        |
| GET      | `/api/logs`                        | Solo localhost                                                        |
| GET      | `/api/diagnostics`                 | Estado, salud, conflicto, red, HID, rutas                             |
| GET      | `/api/diagnostics/download`        | ZIP con diagnóstico, config redactada y log (solo localhost)          |
| WS       | `/api/ws?t=`                       | `hello`, `status`, `settings`, `state`, `safety`, `error`             |

Errores: `400` JSON inválido, `401` token, `403` prohibido/solo lectura,
`404` no encontrado, `409` desconectado o read-back fallido, `413` payload,
`422` campo/valor no válido, `429` rate limit.

## Configuración

`%APPDATA%\ffbeast-remote\config.json`:

```json
{
  "version": 1,
  "port": 47100,
  "token": "…",
  "readOnly": false,
  "allowSaveCommand": true,
  "allowRebootCommand": false,
  "allowDfuCommand": false,
  "stateHz": 20,
  "logLevel": "info",
  "mock": false,
  "autostart": false,
  "conflictProcesses": [
    "PitHouse.exe",
    "Pit House.exe",
    "FFBeast Pit House.exe",
    "FFBeastPitHouse.exe"
  ]
}
```

`autostart` lo gestionan la bandeja, **Ajustes → Seguridad** y los argumentos
`--install-autostart` / `--uninstall-autostart` del hub Rust. El hub Node usa
la tarea programada de `scripts\install-autostart.ps1`.

`reboot` y `dfu` están desactivados a propósito. Para habilitarlos, edita el
archivo con el hub cerrado y reinicia.

## Seguridad

- Token obligatorio en toda la API (salvo `/api/health`).
- Comparación en tiempo constante mediante SHA-256.
- Rate limit de 20 req/s con ráfaga de 40 por IP.
- Solo lectura global para usar el móvil como dashboard en carrera. Se puede
  **activar** desde cualquier dispositivo, pero **desactivar solo desde el PC**.
- Reset de centro y desactivar fuerzas piden mantener pulsado 1,5 s en la UI,
  para evitar toques accidentales con guantes.
- Desactivar fuerzas guarda y reinicia (~2 s): no es un corte instantáneo. Para
  una emergencia real, usa el interruptor físico del volante o desconecta el USB.
- Si el WebSocket no está abierto, la UI bloquea las escrituras para no actuar
  sobre un estado viejo.
- Si hay **3 fallos seguidos** de lectura/escritura, el hub marca el volante como
  inestable y bloquea escrituras hasta que se relean los ajustes con éxito.
- Aviso si se detecta **Pit House abierto** (`conflictProcesses` configurable),
  para evitar que dos programas escriban en el volante a la vez.
- Avisos no bloqueantes si potencia, frenado o efectos superan el 80 %, o si hay
  torque de depuración activo. Se puede seguir ajustando, pero con precaución.
- Aplicar un perfil muestra antes el diff de campos y marca los que reinician.
- **Diagnóstico ZIP** desde Ajustes (solo PC) con `diagnostics.json`,
  `config.redacted.json` y `hub.log`; el token se redacta.
- Cabeceras CSP, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy` en
  la UI y la API.
- `reboot`/`dfu` desactivados; `save` configurable.
- El token se regenera desde el PC e invalida los móviles emparejados.
- Sin telemetría ni acceso a Internet. Todo queda en la LAN.

## Tests

```bash
npm test                    # hub Node (54 pruebas)
cd hub-rs && cargo test     # hub Rust (11 pruebas)
```

El suite del hub Node cubre:

- Vectores dorados del códec (`A3 14 05 00 84 03` para `MotionRange=900`).
- Decodificación de estado, Effects, Hardware, GPIO, ADC y licencia.
- Validación de rangos, índices y compatibilidad.
- Read-back fallido (409) y watchdog de salud tras 3 fallos.
- Auth, rate limit, perfiles, QR, WebSocket y modo solo lectura.
- Desactivar fuerzas, bloqueo de escrituras en solo lectura y `readOnly` local.
- Detección de procesos en conflicto y descarga de diagnóstico sin token.

El hub Rust repite los vectores del códec y los roundtrips de Effects, Hardware,
GPIO, ADC y licencia, y añade la decodificación de reportes reales del volante.

## Problemas frecuentes

| Síntoma                                   | Qué mirar                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| El móvil dice «Reconectando con el hub»   | PC encendido, hub abierto, misma WiFi, firewall privado                                                                          |
| Chrome Android 17: `ERR_TOO_MANY_RETRIES` | Permiso **Dispositivos cercanos** para Chrome (Ajustes → Aplicaciones → Chrome → Permisos); si ya está, quítalo y vuelve a darlo |
| «Volante no detectado» con el USB puesto  | Puerto USB, modo DFU, administración de energía del puerto                                                                       |
| `node-hid` no carga                       | `npm rebuild node-hid`; usa Node 22 LTS; instala Build Tools si no hay prebuild                                                  |
| El puerto 47100 está ocupado              | Cierra otra instancia o cambia `port` en `config.json`                                                                           |
| Los cambios no se aplican                 | Cierra Pit House: dos procesos no deben escribir a la vez                                                                        |
| No aparece el QR                          | Es una ruta de solo localhost: ábrela desde el PC                                                                                |
| Cerrar la pestaña no detiene el hub       | Es intencional: usa **Salir** en la bandeja del sistema                                                                          |
| Abrir el `.exe` no inicia otra copia      | Hay una sola instancia: el acceso directo abre la UI del hub que ya está en la bandeja                                           |
| Windows SmartScreen al distribuir         | Firma el ejecutable o documenta «Más información → Ejecutar»                                                                     |

No uses **Zadig/libusb** con el volante: sustituye el driver HID y deja de
detectarse.

## Notas técnicas (diferencias con el plan)

- **DynamicDampening** (ID 10) **sí** existe en el firmware 26.1.1 y en la
  documentación oficial; la cabecera local estaba desactualizada. Está
  implementado en Effects (offset 14) y requiere firmware 24.1.5+ y PRO.
- **Torque**: la cabecera dice que está normalizado a ±10000. Se publica
  `torquePercent = torque / 100` para la UI y `torqueNormalized = torque / 10000`.
  El plan antiguo usaba `/100` para el normalizado.
- **Perfiles oficiales**: los archivos de la app oficial son volcados de structs
  de 64/128 bytes, con padding sin inicializar. No se importan; el formato propio
  es JSON.
- **Ajustes que requieren reinicio**: `forceEnabled` («Enable forces»), GPIO,
  `resetCenterOnZ0` y la ganancia del amplificador solo se aplican tras
  «Guardar y reiniciar». El hub no hace read-back en esos campos (el firmware
  devuelve el valor viejo hasta el reinicio) y la UI encadena el guardado+reinicio
  automáticamente al cambiarlos o al aplicar un perfil que los incluya.
- **PWA sobre HTTP**: sin service worker; ver la nota de emparejamiento.
- **Rust**: `hub-rs/` sirve la PWA y la API completas desde un único `.exe`
  (~15 MB, sin Node ni consola), con HID real, escrituras, perfiles, QR,
  diagnóstico ZIP, watchdog, detección de Pit House, bandeja, autostart,
  recursos de versión/icono e instalador por usuario. Quedan firma de código y
  auto-update. El hub Node sigue disponible como referencia y fallback.

## Hoja de ruta

| Fase | Contenido                                                                                 |
| ---- | ----------------------------------------------------------------------------------------- |
| M4   | ✅ Pines, Botones, Ejes y Monitor                                                         |
| M5   | ✅ Bandeja, instalador por usuario, regla de firewall automática                          |
| M6   | 🔶 Dynamic dampening ✅; quedan pruebas prolongadas de estabilidad USB con hardware real  |
| M7   | ✅ Hub en Rust, `rust-embed`, bandeja, autostart e instalador; quedan firma y auto-update |

La migración a Rust solo afecta a `hub/`: la API y la PWA no cambian.

## Legal

- Proyecto **no oficial**, sin relación con FFBeast.
- La estética se inspira en **FFBeast Pit House** (MIT). No se ha copiado su
  código; si en el futuro se reutilizan sus componentes, hay que conservar su
  aviso de copyright y licencia.
- El protocolo se ha implementado a partir de la documentación oficial y de
  `ffbeast-wheel-api-lib` (publicada para software de terceros).
- No se incluye ni se modifica firmware, ni se usan logos de FFBeast.
