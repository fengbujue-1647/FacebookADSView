param(
  [ValidateSet("status", "start", "stop", "restart", "elevate-start", "elevate-stop", "elevate-restart")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$manageScript = Join-Path $repoRoot "ops\manage-windows-service.ps1"

if (-not (Test-Path -LiteralPath $manageScript)) {
  throw "Service management script not found: $manageScript"
}

$normalizedAction = $Action
$elevate = $false
if ($Action.StartsWith("elevate-")) {
  $normalizedAction = $Action.Substring("elevate-".Length)
  $elevate = $true
}

if ($elevate) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $manageScript -Action $normalizedAction -Elevate
} else {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $manageScript -Action $normalizedAction
}
exit $LASTEXITCODE
