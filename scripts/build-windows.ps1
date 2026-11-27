#Requires -Version 5.1
<#
.SYNOPSIS
    Genera los paquetes de SpotiDesk para Windows: Instaladores (NSIS .exe + MSI .msi) y Portable (.exe + .zip).
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
    powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1 -Public
    powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1 -Arch arm64 -Public
#>
[CmdletBinding()]
param(
    [ValidateSet("x64", "arm64")]
    [string]$Arch = "x64",
    [switch]$Public
)

$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RootDir

foreach ($cmd in @("pnpm", "cargo", "rustc")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "No se encontró '$cmd' en el PATH. Instálalo antes de continuar."
        exit 1
    }
}

$TauriConf = Get-Content (Join-Path $RootDir "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$ProductName = if ($TauriConf.productName) { $TauriConf.productName } else { "SpotiDesk" }
$Version = if ($TauriConf.version) { $TauriConf.version } else { "0.0.0" }

$CargoToml = Get-Content (Join-Path $RootDir "src-tauri\Cargo.toml") -Raw
$BinName = "spotyfast"
if ($CargoToml -match '(?m)^name\s*=\s*"([^"]+)"') {
    $BinName = $Matches[1]
}

$TargetArgs = @()
if ($Arch -eq "arm64") {
    $TargetTriple = "aarch64-pc-windows-msvc"
    $TargetArgs = @("--target", $TargetTriple)
    $ReleaseDir = Join-Path $RootDir "src-tauri\target\$TargetTriple\release"
} else {
    $ReleaseDir = Join-Path $RootDir "src-tauri\target\release"
}
$BundleDir = Join-Path $ReleaseDir "bundle"

$OutDir = Join-Path $RootDir "releases\windows"
$PortableDir = Join-Path $OutDir "portable"

$BuildSuffix = ""
if ($Public) {
    $env:SPOTIDESK_PUBLIC_BUILD = "1"
    $env:VITE_SPOTIFY_CLIENT_ID = ""
    $BuildSuffix = "_public"
}

Write-Host "============================================================" -ForegroundColor Cyan
if ($Public) {
    Write-Host "  Compilando $ProductName v$Version para Windows ($Arch · PÚBLICO sin Client ID)" -ForegroundColor Cyan
} else {
    Write-Host "  Compilando $ProductName v$Version para Windows ($Arch)" -ForegroundColor Cyan
}
Write-Host "============================================================" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $RootDir "node_modules"))) {
    Write-Host "Instalando dependencias JS con pnpm..."
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Ejecutando compilación Tauri (nsis + msi)..."
$TauriArgs = @("tauri", "build") + $TargetArgs + @("--bundles", "nsis,msi")
& pnpm @TauriArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "La compilación de Tauri falló con código $LASTEXITCODE."
    exit $LASTEXITCODE
}

if (Test-Path $PortableDir) {
    Remove-Item -Recurse -Force $PortableDir
}
New-Item -ItemType Directory -Force -Path $OutDir, $PortableDir | Out-Null

# 1. Portable (.exe autocontenido + .zip)
$ExeSrc = Join-Path $ReleaseDir "$BinName.exe"
if (-not (Test-Path $ExeSrc)) {
    Write-Error "No se encontró el ejecutable compilado en: $ExeSrc"
    exit 1
}

Write-Host "Empaquetando versión portable..."
$PortableExe = Join-Path $PortableDir "$ProductName.exe"
Copy-Item -Force $ExeSrc $PortableExe

# Copiar WebView2Loader.dll si existiera junto al binario
$WebViewLoader = Join-Path $ReleaseDir "WebView2Loader.dll"
if (Test-Path $WebViewLoader) {
    Copy-Item -Force $WebViewLoader (Join-Path $PortableDir "WebView2Loader.dll")
}

$PortableZip = Join-Path $OutDir "${ProductName}_${Version}_windows_${Arch}${BuildSuffix}_portable.zip"
if (Test-Path $PortableZip) { Remove-Item -Force $PortableZip }
Compress-Archive -Path (Join-Path $PortableDir "*") -DestinationPath $PortableZip -CompressionLevel Optimal

# 2. Instaladores (NSIS .exe y MSI .msi)
Write-Host "Copiando instaladores..."
$GeneratedInstallers = @()

$NsisSrc = Get-ChildItem -Path (Join-Path $BundleDir "nsis") -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($NsisSrc) {
    $NsisOut = Join-Path $OutDir "${ProductName}_${Version}_windows_${Arch}${BuildSuffix}_setup.exe"
    Copy-Item -Force $NsisSrc.FullName $NsisOut
    $GeneratedInstallers += $NsisOut
}

$MsiSrc = Get-ChildItem -Path (Join-Path $BundleDir "msi") -Filter "*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($MsiSrc) {
    $MsiOut = Join-Path $OutDir "${ProductName}_${Version}_windows_${Arch}${BuildSuffix}_installer.msi"
    Copy-Item -Force $MsiSrc.FullName $MsiOut
    $GeneratedInstallers += $MsiOut
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Build Windows completado en: $OutDir" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
foreach ($inst in $GeneratedInstallers) {
    $sizeMb = [math]::Round((Get-Item $inst).Length / 1MB, 2)
    Write-Host "  Instalador: $inst ($sizeMb MB)"
}
$zipMb = [math]::Round((Get-Item $PortableZip).Length / 1MB, 2)
$exeMb = [math]::Round((Get-Item $PortableExe).Length / 1MB, 2)
Write-Host "  Portable (.zip): $PortableZip ($zipMb MB)"
Write-Host "  Portable (.exe): $PortableExe ($exeMb MB)"
