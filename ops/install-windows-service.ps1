param(
  [string]$ServiceName = "FbAdsDashboardSentinel",
  [string]$DisplayName = "FB Ads Dashboard Sentinel",
  [string]$Description = "Watches and restarts the FB ads dashboard with exponential backoff and a daily restart limit.",
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$NodePath = "",
  [switch]$Force,
  [switch]$Start
)

$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-CscPath {
  $candidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  throw "Cannot find .NET Framework csc.exe; unable to build the Windows Service wrapper."
}

if (-not (Test-IsAdministrator)) {
  throw "Installing a Windows service requires an elevated Administrator PowerShell."
}

if (-not $NodePath) {
  $nodeCommand = Get-Command node -ErrorAction Stop
  $NodePath = $nodeCommand.Source
}

$sentinelScript = Join-Path $RepoRoot "ops\sentinel.js"
$serviceSource = Join-Path $RepoRoot "ops\windows-service\FbAdsDashboardSentinelService.cs"
$serviceDir = Join-Path $RepoRoot "data\sentinel"
$serviceExe = Join-Path $serviceDir "FbAdsDashboardSentinelService.exe"

if (-not (Test-Path -LiteralPath $sentinelScript)) {
  throw "Sentinel script not found: $sentinelScript"
}
if (-not (Test-Path -LiteralPath $serviceSource)) {
  throw "Windows Service wrapper source not found: $serviceSource"
}

New-Item -ItemType Directory -Force -Path $serviceDir | Out-Null

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  if (-not $Force) {
    throw "Service $ServiceName already exists; use -Force to reinstall."
  }
  if ($existing.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction Stop
  }
  & sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

$csc = Get-CscPath
& $csc /nologo /target:exe /out:$serviceExe /reference:System.ServiceProcess.dll $serviceSource
if ($LASTEXITCODE -ne 0) {
  throw "Windows Service wrapper compilation failed."
}

& $NodePath $sentinelScript --check-config | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Sentinel configuration check failed."
}

$binaryPath = "`"$serviceExe`" --service-name `"$ServiceName`" --node `"$NodePath`" --repo `"$RepoRoot`" --script `"$sentinelScript`""
New-Service -Name $ServiceName -BinaryPathName $binaryPath -DisplayName $DisplayName -StartupType Automatic | Out-Null
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName" -Name Description -Value $Description

& sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/300000/none/0 | Out-Null
& sc.exe failureflag $ServiceName 1 | Out-Null

if ($Start) {
  Start-Service -Name $ServiceName
}

Get-Service -Name $ServiceName
