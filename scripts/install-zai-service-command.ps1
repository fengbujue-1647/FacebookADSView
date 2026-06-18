$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceScript = Join-Path $repoRoot "scripts\zai-service.ps1"
$targetDir = Join-Path $env:APPDATA "npm"
$targetPs1 = Join-Path $targetDir "zai-service.ps1"
$targetCmd = Join-Path $targetDir "zai-service.cmd"

if (-not (Test-Path -LiteralPath $sourceScript)) {
  throw "Source script not found: $sourceScript"
}

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$ps1Content = @"
param(
  [ValidateSet("status", "start", "stop", "restart", "elevate-start", "elevate-stop", "elevate-restart")]
  [string]`$Action = "status"
)

& powershell -NoProfile -ExecutionPolicy Bypass -File "$sourceScript" -Action `$Action
"@

$cmdContent = @"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%APPDATA%\npm\zai-service.ps1" %*
"@

Set-Content -LiteralPath $targetPs1 -Value $ps1Content -Encoding UTF8
Set-Content -LiteralPath $targetCmd -Value $cmdContent -Encoding ASCII

Write-Host "Installed global command: zai-service"
Write-Host "Available actions:"
Write-Host "  zai-service status"
Write-Host "  zai-service start"
Write-Host "  zai-service stop"
Write-Host "  zai-service restart"
Write-Host "  zai-service elevate-restart"
Write-Host ""
Write-Host "Target directory: $targetDir"
