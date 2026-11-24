param([switch]$Remove)
$ErrorActionPreference = "Stop"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecuta este script como administrador."
}

$ruleName = "FFBeast Remote"
$oldRuleName = "FFBeast Remote (TCP 47100)"

if ($Remove) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Get-NetFirewallRule -DisplayName $oldRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host "Regla de firewall eliminada."
    exit 0
}

$exe = Join-Path $PSScriptRoot "ffbeast-hub.exe"
if (-not (Test-Path $exe)) {
    throw "No existe $exe"
}

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName $oldRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Program $exe `
    -Profile Private `
    -Description "Permite FFBeast Remote en la red local." | Out-Null

Write-Host "Regla de firewall creada para $exe (solo red privada)."
