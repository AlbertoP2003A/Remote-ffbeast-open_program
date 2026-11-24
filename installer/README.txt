FFBeast Remote
==============

Control del volante FFBeast desde el PC y desde el móvil, sin Pit House.

La aplicación arranca en la bandeja del sistema y no abre ninguna consola.
La interfaz se usa en el navegador:

  http://localhost:47100/

Para el móvil:
1. PC y teléfono en la misma WiFi.
2. En el PC, abre la interfaz y ve a Ajustes -> Emparejar un móvil.
3. Escanea el QR o abre la URL que aparece.
4. En el móvil, usa "Añadir a pantalla de inicio".

Bandeja
-------
- Abrir interfaz
- Modo solo lectura
- Iniciar con Windows (también en Ajustes -> Seguridad)
- Abrir carpeta de datos
- Salir

Cerrar la pestaña del navegador no cierra el hub. Para detenerlo usa
"Salir" en la bandeja.

Datos
-----
Configuración, token y perfiles:
  %APPDATA%\ffbeast-remote\

Firewall
--------
Si el móvil no conecta, comprueba que la red de Windows está configurada como
Privada. El instalador puede crear una regla por programa para
ffbeast-hub.exe (solo redes privadas; no depende del puerto). Si no la creaste
al instalar, ejecuta como administrador:

  powershell -ExecutionPolicy Bypass -File firewall.ps1

Para quitarla:

  powershell -ExecutionPolicy Bypass -File firewall.ps1 -Remove

Firma
-----
Este instalador no está firmado. Si SmartScreen muestra un aviso:
  Más información -> Ejecutar de todas formas.

Desinstalación
--------------
Desde Configuración -> Aplicaciones -> FFBeast Remote, o desde el menú Inicio.
El desinstalador preguntará si quieres borrar también los perfiles y la
configuración.

Proyecto no oficial, sin relación con FFBeast. Licencia MIT.
