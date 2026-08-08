$ErrorActionPreference = "Stop"

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profileRoot = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
$port = 9222

if (-not (Test-Path -LiteralPath $chrome)) {
  throw "Chrome was not found at $chrome"
}

Write-Host ""
Write-Host "Launching Chrome with remote debugging on http://127.0.0.1:$port"
Write-Host "Using profile root: $profileRoot"
Write-Host ""
Write-Host "Important: close all normal Chrome windows before running this."
Write-Host "If Chrome is already running, Windows may reuse the old process and the debug port will not open."
Write-Host ""

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$port",
  "--user-data-dir=$profileRoot",
  "https://dashboard.tenderly.co/"
)

Write-Host "Chrome launch requested. Keep this Chrome window open while Codex inspects Tenderly."
