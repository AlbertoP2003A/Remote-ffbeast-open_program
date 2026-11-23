# FFBeast Remote

Control del volante **FFBeast** desde el PC y desde el móvil, sin depender de
Pit House.

El PC ejecuta un **hub** que es el único que habla USB HID con el volante y
publica una API HTTP/WebSocket. La interfaz es una **PWA** servida por ese mismo
hub: la misma en el navegador del PC y en el teléfono.

> Proyecto no oficial. No incluye firmware ni software propietario de FFBeast.

## Estado

MVP completo (M0–M4) probado con hardware real (FFBeast 26.1.1 PRO) y con el
dispositivo simulado:

- Detección y reconexión automática del volante.
- Lectura de Effects, Hardware, GPIO, ADC y licencia.
- Escritura con **read-back** y errores claros.
- Estado en vivo por WebSocket a 20 Hz.
- Perfiles JSON (crear, aplicar, borrar, importar/exportar).
- **Pines**: 10 pines con sus modos, extensión y bus SPI.
- **Botones**: matriz de 32 botones con modos y edición por lotes.
- **Ejes**: 3 ejes ADC con zonas muertas, suavizado y umbrales.
- **Monitor**: gráfica de posición/torque de 30 s, pausa y exportación CSV.
- Token, QR, rate limit, modo solo lectura y registro.
- UI responsive con estética oscura tipo Pit House.

Pendiente (fases siguientes): bandeja e instalador (M5), pulido de hardware y
dynamic dampening (M6), distribución single-exe (M7).

## Requisitos

- Windows 10/11.
- **Node.js 22 LTS** (o 24 LTS). Node 20 ya no tiene soporte.
- El volante conectado por USB al PC.
- Para el móvil: misma red WiFi que el PC.

## Instalación y arranque

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

| Variable | Efecto |
|---|---|
| `FFBEAST_PORT` | Puerto HTTP (por defecto 47100) |
| `FFBEAST_MOCK=1` | Usa el volante simulado |
| `FFBEAST_READ_ONLY=1` | Arranca en solo lectura |
| `FFBEAST_DATA_DIR` | Cambia la carpeta de datos |
| `FFBEAST_STATE_HZ` | Frecuencia del estado en vivo (1–60) |
| `FFBEAST_LOG_LEVEL` | `debug`, `info`, `warn`, `error` |
| `FFBEAST_OPEN=1` | Abre el navegador al arrancar |

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
│  │  │  └─ compatibility.ts
│  │  └─ server/
│  │     ├─ http.ts      # API + estáticos
│  │     ├─ ws.ts        # estado en vivo
│  │     ├─ auth.ts      # token timing-safe + rate limit
│  │     ├─ net.ts       # elección de IP de LAN
│  │     └─ static.ts    # PWA con fallback SPA
│  └─ test/              # códec, auth y API (42 tests)
├─ web/                  # PWA React + Vite
│  ├─ src/pages/         # Dashboard, Efectos, Hardware, Pines, Botones, Ejes,
│  │                     # Monitor, Perfiles, Ajustes
│  ├─ src/components/    # Layout, controles, gauge, gráfica, borradores, toasts
│  ├─ src/hub.tsx        # contexto: API + WebSocket + acciones
│  ├─ src/live.ts        # estado en vivo aislado de React
│  └─ public/            # manifest e iconos
└─ scripts/              # firewall, autostart, iconos
```

## API

Base: `http://<host>:47100`. Autenticación por `Authorization: Bearer <token>`,
`?t=<token>` o cookie HttpOnly (solo localhost). También existe el alias
`/api/v1/...`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Sin auth |
| GET | `/api/status` | Conexión, firmware, licencia, modo |
| GET | `/api/settings` | Ajustes + metadatos de campos |
| POST | `/api/settings` | `{ field, index?, value }` (nombre o ID) |
| POST | `/api/settings/apply` | Aplica un bloque o perfil |
| GET | `/api/state` | Última posición/torque |
| POST | `/api/command` | `reset-center`, `save`, `reboot`, `dfu` |
| GET/POST | `/api/profiles` | Lista / crea |
| POST | `/api/profiles/apply` | Aplica `{ id }` |
| DELETE | `/api/profiles/:id` | Borra |
| GET/POST | `/api/profiles/export` · `/import` | Exporta / importa JSON |
| GET/POST | `/api/config` | Configuración pública / solo lectura |
| GET | `/api/token` | Solo localhost |
| POST | `/api/token/regenerate` | Solo localhost |
| GET | `/api/qr` · `/api/qr/url` | Solo localhost |
| GET | `/api/logs` | Solo localhost |
| GET | `/api/diagnostics` | Estado, red, HID, rutas |
| WS | `/api/ws?t=` | `hello`, `status`, `settings`, `state`, `error` |

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
  "mock": false
}
```

`reboot` y `dfu` están desactivados a propósito. Para habilitarlos, edita el
archivo con el hub cerrado y reinicia.

## Seguridad

- Token obligatorio en toda la API (salvo `/api/health`).
- Comparación en tiempo constante mediante SHA-256.
- Rate limit de 20 req/s con ráfaga de 40 por IP.
- Solo lectura global para usar el móvil como dashboard en carrera.
- `reboot`/`dfu` desactivados; `save` configurable.
- El token se regenera desde el PC e invalida los móviles emparejados.
- Sin telemetría ni acceso a Internet. Todo queda en la LAN.

## Tests

```bash
npm test
```

Cubre:

- Vectores dorados del códec (`A3 14 05 00 84 03` para `MotionRange=900`).
- Decodificación de estado, Effects, Hardware, GPIO, ADC y licencia.
- Validación de rangos, índices y compatibilidad.
- Read-back fallido (409).
- Auth, rate limit, perfiles, QR, WebSocket y modo solo lectura.

## Problemas frecuentes

| Síntoma | Qué mirar |
|---|---|
| El móvil dice «Reconectando con el hub» | PC encendido, hub abierto, misma WiFi, firewall privado |
| Chrome Android 17: `ERR_TOO_MANY_RETRIES` | Permiso **Dispositivos cercanos** para Chrome (Ajustes → Aplicaciones → Chrome → Permisos); si ya está, quítalo y vuelve a darlo |
| «Volante no detectado» con el USB puesto | Puerto USB, modo DFU, administración de energía del puerto |
| `node-hid` no carga | `npm rebuild node-hid`; usa Node 22 LTS; instala Build Tools si no hay prebuild |
| El puerto 47100 está ocupado | Cierra otra instancia o cambia `port` en `config.json` |
| Los cambios no se aplican | Cierra Pit House: dos procesos no deben escribir a la vez |
| No aparece el QR | Es una ruta de solo localhost: ábrela desde el PC |
| Windows SmartScreen al distribuir | Firma el ejecutable o documenta «Más información → Ejecutar» |

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

## Hoja de ruta

| Fase | Contenido |
|---|---|
| M4 | ✅ Pines, Botones, Ejes y Monitor |
| M5 | Bandeja, instalador del arranque, regla de firewall automática |
| M6 | Pruebas con volante real, dynamic dampening y estabilidad USB |
| M7 | Hub en Rust + `rust-embed` + instalador firmado (un único `.exe`) |

La migración a Rust solo afecta a `hub/`: la API y la PWA no cambian.

## Legal

- Proyecto **no oficial**, sin relación con FFBeast.
- La estética se inspira en **FFBeast Pit House** (MIT). No se ha copiado su
  código; si en el futuro se reutilizan sus componentes, hay que conservar su
  aviso de copyright y licencia.
- El protocolo se ha implementado a partir de la documentación oficial y de
  `ffbeast-wheel-api-lib` (publicada para software de terceros).
- No se incluye ni se modifica firmware, ni se usan logos de FFBeast.
