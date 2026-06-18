param(
  [ValidateSet("status", "start", "stop", "restart")]
  [string]$Action = "status",
  [string]$ServiceName = "FbAdsDashboardSentinel",
  [int]$TimeoutSeconds = 30,
  [int]$Port = 3100,
  [switch]$Elevate
)

$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Format-LocalScriptCommand {
  param([string]$RequestedAction)
  return "powershell -NoProfile -ExecutionPolicy Bypass -File ops/manage-windows-service.ps1 -Action $RequestedAction"
}

function Write-AdminInstruction {
  param([string]$RequestedAction)
  Write-Host "Action '$RequestedAction' requires an elevated Administrator PowerShell."
  Write-Host "Run this from any directory if the global command is installed:"
  Write-Host ""
  Write-Host "  zai-service $RequestedAction"
  Write-Host ""
  Write-Host "Or ask Windows for UAC elevation:"
  Write-Host ""
  Write-Host "  zai-service elevate-$RequestedAction"
  Write-Host ""
  Write-Host "Repo-local fallback:"
  Write-Host ""
  Write-Host "  $(Format-LocalScriptCommand -RequestedAction $RequestedAction)"
  Write-Host ""
  Write-Host "  $(Format-LocalScriptCommand -RequestedAction $RequestedAction) -Elevate"
}

function Invoke-ElevatedSelf {
  param([string]$RequestedAction)
  $scriptPath = $PSCommandPath
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$scriptPath`"",
    "-Action", $RequestedAction,
    "-ServiceName", $ServiceName,
    "-TimeoutSeconds", $TimeoutSeconds,
    "-Port", $Port
  )
  Start-Process -FilePath "powershell" -ArgumentList $arguments -Verb RunAs | Out-Null
  Write-Host "Requested elevated PowerShell for action '$RequestedAction'."
}

function Get-TargetService {
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $service) {
    throw "Service '$ServiceName' is not installed. Install it with: npm run service:install"
  }
  return $service
}

function Wait-ServiceStatus {
  param(
    [System.ServiceProcess.ServiceController]$Service,
    [System.ServiceProcess.ServiceControllerStatus]$Status
  )
  $Service.WaitForStatus($Status, [TimeSpan]::FromSeconds($TimeoutSeconds))
  $Service.Refresh()
  if ($Service.Status -ne $Status) {
    throw "Timed out waiting for service '$ServiceName' to reach status '$Status'. Current status: $($Service.Status)"
  }
}

function Read-PortOwner {
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) {
    return $null
  }
  return $connection.OwningProcess
}

function Write-ServiceStatus {
  $service = Get-TargetService
  $service.Refresh()
  $cim = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  $portOwner = Read-PortOwner

  Write-Host "Service: $ServiceName"
  Write-Host "Status:  $($service.Status)"
  if ($cim) {
    Write-Host "PID:     $($cim.ProcessId)"
    Write-Host "Start:   $($cim.StartMode)"
  }
  if ($portOwner) {
    Write-Host "Port:    $Port listening by PID $portOwner"
  } else {
    Write-Host "Port:    $Port not listening"
  }
}

if ($Elevate) {
  Invoke-ElevatedSelf -RequestedAction $Action
  exit 0
}

if ($Action -ne "status" -and -not (Test-IsAdministrator)) {
  Write-AdminInstruction -RequestedAction $Action
  exit 1
}

$service = Get-TargetService

switch ($Action) {
  "status" {
    Write-ServiceStatus
  }
  "start" {
    if ($service.Status -ne "Running") {
      Start-Service -Name $ServiceName -ErrorAction Stop
      $service.Refresh()
      Wait-ServiceStatus -Service $service -Status ([System.ServiceProcess.ServiceControllerStatus]::Running)
    }
    Write-ServiceStatus
  }
  "stop" {
    if ($service.Status -ne "Stopped") {
      Stop-Service -Name $ServiceName -Force -ErrorAction Stop
      $service.Refresh()
      Wait-ServiceStatus -Service $service -Status ([System.ServiceProcess.ServiceControllerStatus]::Stopped)
    }
    Write-ServiceStatus
  }
  "restart" {
    if ($service.Status -ne "Stopped") {
      Stop-Service -Name $ServiceName -Force -ErrorAction Stop
      $service.Refresh()
      Wait-ServiceStatus -Service $service -Status ([System.ServiceProcess.ServiceControllerStatus]::Stopped)
    }
    Start-Service -Name $ServiceName -ErrorAction Stop
    $service.Refresh()
    Wait-ServiceStatus -Service $service -Status ([System.ServiceProcess.ServiceControllerStatus]::Running)
    Write-ServiceStatus
  }
}
