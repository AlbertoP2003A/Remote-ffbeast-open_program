# Registra FFBeast Remote para que arranque al iniciar sesión.
# Uso (sin admin): powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root "hub\dist\index.js"
$vbs = Join-Path $root "scripts\start-hidden.vbs"

if (-not (Test-Path $entry)) {
    throw "No existe $entry. Ejecuta primero: npm run build"
}
if (-not (Test-Path $vbs)) {
    throw "No existe $vbs"
}

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName "FFBeastRemote" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "FFBeast Remote Hub (control del volante desde PC y movil)" `
    -Force | Out-Null

Write-Host "Tarea 'FFBeastRemote' registrada. Se iniciara al entrar en Windows."
Write-Host "Para arrancarla ahora: Start-ScheduledTask -TaskName FFBeastRemote"
