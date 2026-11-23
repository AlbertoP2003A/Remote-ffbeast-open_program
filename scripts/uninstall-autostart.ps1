# Elimina el arranque automatico de FFBeast Remote.
$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName "FFBeastRemote" -ErrorAction SilentlyContinue
if ($null -eq $task) {
    Write-Host "La tarea 'FFBeastRemote' no existe."
    exit 0
}

Unregister-ScheduledTask -TaskName "FFBeastRemote" -Confirm:$false
Write-Host "Tarea 'FFBeastRemote' eliminada."
