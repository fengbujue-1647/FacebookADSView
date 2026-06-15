param(
  [string]$ServiceName = "FbAdsDashboardSentinel",
  [switch]$RemoveGeneratedFiles
)

$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  throw "Uninstalling a Windows service requires an elevated Administrator PowerShell."
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction Stop
  }
  & sc.exe delete $ServiceName | Out-Null
}

if ($RemoveGeneratedFiles) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  $serviceExe = Join-Path $repoRoot "data\sentinel\FbAdsDashboardSentinelService.exe"
  if (Test-Path -LiteralPath $serviceExe) {
    Remove-Item -LiteralPath $serviceExe -Force
  }
}
