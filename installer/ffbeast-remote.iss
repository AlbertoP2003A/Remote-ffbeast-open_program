#define MyAppName "FFBeast Remote"
#define MyAppPublisher "FFBeast Remote (no oficial)"
#define MyAppExeName "ffbeast-hub.exe"

#ifndef MyAppVersion
  #define MyAppVersion "1.2.1"
#endif

[Setup]
AppId={{DEC8262C-D7BC-4383-8C99-AECC6269423B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\FFBeast Remote
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=FFBeastRemote-Setup-{#MyAppVersion}
SetupIconFile=..\hub-rs\assets\ffbeast.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
LicenseFile=..\LICENSE
VersionInfoVersion={#MyAppVersion}.0
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoDescription=Instalador de FFBeast Remote
VersionInfoCompany={#MyAppPublisher}
CloseApplications=no
RestartApplications=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: unchecked
Name: "autostart"; Description: "Iniciar FFBeast Remote al iniciar sesión"; GroupDescription: "Inicio:"; Flags: unchecked
Name: "firewall"; Description: "Permitir el acceso desde el móvil (firewall de Windows)"; GroupDescription: "Red:"; Flags: checkedonce

[Files]
Source: "..\hub-rs\target\release\ffbeast-hub.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\THIRD-PARTY.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "firewall.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\FFBeast Remote"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--open"; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\Desinstalar FFBeast Remote"; Filename: "{uninstallexe}"
Name: "{autodesktop}\FFBeast Remote"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--open"; WorkingDir: "{app}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--install-autostart --quiet"; Flags: runhidden; Tasks: autostart; StatusMsg: "Activando el inicio con Windows..."
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\firewall.ps1"""; Verb: "runas"; Flags: shellexec waituntilterminated; Tasks: firewall; StatusMsg: "Configurando el firewall de Windows..."
Filename: "{app}\{#MyAppExeName}"; Parameters: "--open"; Description: "Abrir FFBeast Remote"; Flags: postinstall nowait skipifsilent

[UninstallRun]

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function AutostartPointsHere(): Boolean;
var
  Value: String;
  Path: String;
begin
  // Solo quita el autostart si apunta a esta instalación; si apunta a otra
  // copia (por ejemplo la portable), se deja intacto.
  Path := Lowercase(ExpandConstant('{app}\{#MyAppExeName}'));
  Result := RegQueryStringValue(
    HKCU,
    'Software\Microsoft\Windows\CurrentVersion\Run',
    'FFBeastRemote',
    Value
  );
  Log('autostart: valor=[' + Value + '] ruta=[' + Path + ']');
  if Result then
  begin
    Result := Pos(Path, Lowercase(Value)) > 0;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  // Cierra una instancia anterior para poder reemplazar el .exe.
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM ffbeast-hub.exe /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Migración: elimina la tarea programada del hub Node antiguo, si existe.
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN FFBeastRemote /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

function FirewallRuleExists(): Boolean;
var
  ResultCode: Integer;
begin
  // Consultar la regla no requiere elevación; solo borrarla sí.
  Result :=
    Exec(
      ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetFirewallRule -DisplayName ''FFBeast Remote'' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"',
      '',
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    ) and (ResultCode = 0);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ErrorCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Cierra el hub para poder borrar el .exe y para que el autostart no
    // dependa de una instancia en ejecución.
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM {#MyAppExeName} /F', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
    // Quita el autostart solo si apunta a esta instalación; si apunta a otra
    // copia (por ejemplo la portable), se deja intacto.
    if AutostartPointsHere() then
      Exec(ExpandConstant('{app}\{#MyAppExeName}'), '--uninstall-autostart --quiet', '', SW_HIDE, ewWaitUntilTerminated, ErrorCode);
    if FirewallRuleExists() then
    begin
      ShellExec(
        'runas',
        ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
        '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' +
          ExpandConstant('{app}\firewall.ps1') + '" -Remove',
        '',
        SW_HIDE,
        ewWaitUntilTerminated,
        ErrorCode
      );
    end;
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    if not UninstallSilent then
    begin
      if MsgBox('¿Quieres borrar también los perfiles y la configuración de FFBeast Remote?', mbConfirmation, MB_YESNO) = IDYES then
        DelTree(ExpandConstant('{userappdata}\ffbeast-remote'), True, True, True);
    end;
  end;
end;
