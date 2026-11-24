# hub-rs

Hub de FFBeast Remote en Rust. Sirve la misma PWA, la misma API y el mismo
WebSocket que el hub Node, en un único ejecutable.

## Estado

Hecho:

- Driver HID con reconexión, lectura de feature reports, estado en vivo,
  joystick y cola de escrituras.
- HTTP/WS con auth por token, rate limit, modo solo lectura, QR, logs,
  diagnósticos, perfiles y configuración compatible con el hub Node.
- Escritura de ajustes con read-back, comandos, aplicar bloques/perfiles y
  desactivar fuerzas con verificación.
- Watchdog de salud, detección de Pit House y evento `safety`.
- PWA **embebida** en el ejecutable (`rust-embed`) y single-instance.
- **Bandeja del sistema** con estado, abrir UI, solo lectura, autostart, carpeta
  de datos y salir.
- **Autostart configurable** (HKCU Run, sin admin) desde la bandeja y desde la
  PWA; también `--install-autostart` / `--uninstall-autostart`.
- Sin consola en release (`windows_subsystem = "windows"`); los errores fatales
  salen por MessageBox.
- Modo simulado (`--mock`).
- **Instalador por usuario** (Inno Setup 6), accesos directos, autostart
  opcional, firewall por programa, icono y versión de Windows en el `.exe`.

Pendiente para cerrar M7:

- Firma de código (sin certificado por ahora: SmartScreen avisa).
- Auto-actualización.

## Requisitos de compilación

1. Node 22 para compilar la PWA:

   ```bash
   cd ..
   npm run build
   ```

   `rust-embed` incluye `web/dist` en el binario al compilar.

2. Rust GNU + binutils. En Windows, `windows-sys` necesita `dlltool.exe`:

   ```bash
   rustup default stable-x86_64-pc-windows-gnu
   export PATH="/c/Users/alber/AppData/Local/ffbeast-toolchain/mingw64/bin:$PATH"
   ```

   El toolchain de WinLibs se extrajo en
   `C:\Users\alber\AppData\Local\ffbeast-toolchain\mingw64\bin`.

## Compilar y ejecutar

```bash
cargo test
cargo build --bin ffbeast-hub             # consola + bandeja (debug)
./target/debug/ffbeast-hub.exe --open

cargo build --release --bin ffbeast-hub   # sin consola (GUI) + bandeja
./target/release/ffbeast-hub.exe --open
```

La build release es `Windows GUI`: no abre consola. La debug mantiene la consola
para ver logs. Usa la misma configuración que el hub Node:
`%APPDATA%\ffbeast-remote\config.json`.

Opciones útiles:

```bash
--port 47100
--mock
--read-only
--state-hz 20
--web-root ../web/dist   # usar la UI de disco en desarrollo
--data-dir <carpeta>
--install-autostart
--uninstall-autostart
--quiet                  # sin diálogos (instalador/scripts)
--no-tray                # sin bandeja (diagnóstico; bloquea con Ctrl+C)
```

El binario es autónomo: no necesita Node, `node_modules` ni `web/dist` al
ejecutarse. Pesa ~15 MB.

## Instalador

El instalador usa **Inno Setup 6** y se genera desde la raíz del repositorio:

```powershell
npm run installer
# o: powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
```

El script:

1. Regenera los iconos (`web/public/icons` y `hub-rs/assets/ffbeast.ico`).
2. Compila la PWA (`web/dist`), que queda embebida en el `.exe`.
3. Compila `ffbeast-hub.exe` en release con `windres` para el icono y la
   versión. Si existe, añade WinLibs al `PATH`.
4. Compila `installer/ffbeast-remote.iss` y deja
   `dist/FFBeastRemote-Setup-<version>.exe` y su `.sha256`.

Detalles del instalador:

- Por usuario en `%LOCALAPPDATA%\FFBeast Remote`, sin administrador, x64,
  Windows 10/11.
- Autostart opcional (desmarcado en instalación nueva, se conserva al
  actualizar).
- Firewall opcional: regla por programa para `ffbeast-hub.exe` en red privada
  (UAC una vez).
- Desinstalador: cierra el hub, quita el autostart si apunta a esta copia,
  elimina la regla de firewall y pregunta si borrar `%APPDATA%\ffbeast-remote`.
- Migración: borra la tarea programada `FFBeastRemote` del hub Node.
- Sin firma: SmartScreen avisará. Firma pendiente de certificado.

## Paquete portable

La build release es autónoma. El paquete listo para probar queda en:

```
target/ffbeast-hub-1.0.0-win64.zip
```

Contiene `ffbeast-hub.exe`, `start.cmd`, `firewall.ps1`, `README.txt` y
`LICENSE`. Para regenerarlo:

1. `node scripts/gen-icons.mjs` (iconos de la PWA y `.ico` del `.exe`).
2. `npm run build -w @ffbeast/web`.
3. `cargo build --release --bin ffbeast-hub`.
4. Copiar el `.exe` a `target/ffbeast-hub-1.0.0-win64/` y comprimir el
   contenido de esa carpeta (los archivos en la raíz del ZIP).

## Sonda

```bash
cargo run --release --bin probe
```

Solo lectura: enumera MI_00/MI_01, decodifica los feature reports y muestra los
ejes del joystick durante 2 s.
