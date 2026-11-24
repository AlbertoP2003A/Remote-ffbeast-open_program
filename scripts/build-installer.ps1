# Genera el instalador de FFBeast Remote.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
[CmdletBinding()]
param(
    # Version del instalador; por defecto se lee de hub-rs\Cargo.toml.
    [string]$Version,
    [switch]$SkipWeb,
    [switch]$SkipRust
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not $Version) {
        $cargoToml = Join-Path $root "hub-rs\Cargo.toml"
        $match = Select-String -Path $cargoToml -Pattern '^version\s*=\s*"([^"]+)"' |
            Select-Object -First 1
        if (-not $match) {
            throw "No se pudo leer la version de hub-rs\Cargo.toml"
        }
        $Version = $match.Matches[0].Groups[1].Value
    }
    Write-Host "Version: $Version"

    # 1. Iconos de la PWA y del ejecutable (hub-rs\assets\ffbeast.ico).
    node scripts/gen-icons.mjs
    if ($LASTEXITCODE -ne 0) { throw "Fallo generando los iconos." }

    # 2. PWA: rust-embed incluye web\dist dentro del .exe.
    if (-not $SkipWeb) {
        npm run build -w @ffbeast/web
        if ($LASTEXITCODE -ne 0) { throw "Fallo compilando la PWA." }
    } else {
        if (-not (Test-Path (Join-Path $root "web\dist\index.html"))) {
            throw "No existe web\dist. Compila la PWA o quita -SkipWeb."
        }
        Write-Host "PWA: se usa web\dist existente."
    }

    # 3. Hub Rust en modo release (sin consola, con icono y version).
    if (-not $SkipRust) {
        $winlibs = "C:\Users\alber\AppData\Local\ffbeast-toolchain\mingw64\bin"
        if (Test-Path $winlibs) {
            $env:PATH = "$winlibs;$env:PATH"
        }
        $cargoExe = (Get-Command cargo -ErrorAction SilentlyContinue).Source
        if (-not $cargoExe) {
            $cargoExe = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
        }
        if (-not (Test-Path $cargoExe)) {
            throw "No se encontro cargo. Instala Rust o anade %USERPROFILE%\.cargo\bin al PATH."
        }
        Push-Location (Join-Path $root "hub-rs")
        try {
            & $cargoExe build --release --bin ffbeast-hub
            if ($LASTEXITCODE -ne 0) { throw "Fallo compilando el hub Rust." }
        } finally {
            Pop-Location
        }
    } else {
        if (-not (Test-Path (Join-Path $root "hub-rs\target\release\ffbeast-hub.exe"))) {
            throw "No existe hub-rs\target\release\ffbeast-hub.exe. Compila el hub o quita -SkipRust."
        }
        Write-Host "Hub Rust: se usa el .exe release existente."
    }

    # 4. Inno Setup 6.
    $iscc = $env:ISCC
    if (-not $iscc) {
        $candidates = @(
            (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
            (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
            (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
        )
        $iscc = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    }
    if (-not $iscc) {
        throw "No se encontro ISCC.exe. Instala Inno Setup 6 o define la variable ISCC."
    }

    $iss = Join-Path $root "installer\ffbeast-remote.iss"
    & $iscc "/DMyAppVersion=$Version" $iss
    if ($LASTEXITCODE -ne 0) { throw "Fallo compilando el instalador." }

    $setup = Join-Path $root "dist\FFBeastRemote-Setup-$Version.exe"
    if (-not (Test-Path $setup)) { throw "No se genero $setup" }

    $hash = (Get-FileHash $setup -Algorithm SHA256).Hash
    $size = [math]::Round((Get-Item $setup).Length / 1MB, 1)
    $name = "FFBeastRemote-Setup-$Version.exe"
    Set-Content -Path "$setup.sha256" -Value "$hash  $name" -Encoding ASCII

    Write-Host ""
    Write-Host "Instalador: $setup"
    Write-Host "Tamano:     $size MB"
    Write-Host "SHA-256:    $hash"
} finally {
    Pop-Location
}
