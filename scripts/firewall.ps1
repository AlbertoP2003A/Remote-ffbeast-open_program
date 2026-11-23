# Abre el puerto 47100 solo en redes privadas para que el movil pueda conectar.
# Requiere PowerShell como administrador.
$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecuta este script como administrador."
}

$ruleName = "FFBeast Remote (TCP 47100)"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($null -ne $existing) {
    Remove-NetFirewallRule -DisplayName $ruleName
}

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 47100 `
    -Profile Private `
    -Description "Permite el hub FFBeast Remote en la red local." | Out-Null

Write-Host "Regla creada: TCP 47100 permitido en el perfil Private."
Write-Host "Comprueba que tu WiFi de casa esta marcada como red privada."
