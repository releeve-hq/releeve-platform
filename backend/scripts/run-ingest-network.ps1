param(
    [ValidateSet("mainnet", "testnet")]
    [string]$Network = "testnet",
    [string]$HorizonUrl = "",
    [string]$RpcUrl = "",
    [int]$MaxLedgersPerPass = 50
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$env:INGEST_NETWORK = $Network
$env:INGEST_MAX_LEDGERS_PER_PASS = "$MaxLedgersPerPass"

if (-not $HorizonUrl) {
    $HorizonUrl = if ($Network -eq "mainnet") {
        "https://horizon.stellar.org"
    } else {
        "https://horizon-testnet.stellar.org"
    }
}

$env:INGEST_HORIZON_URL = $HorizonUrl

if ($RpcUrl) {
    $env:INGEST_RPC_URL = $RpcUrl
} elseif ($Network -eq "testnet") {
    $env:INGEST_RPC_URL = "https://soroban-testnet.stellar.org"
} else {
    Remove-Item Env:\INGEST_RPC_URL -ErrorAction SilentlyContinue
}

Write-Host "Starting Releeve ingest for $Network"
Write-Host "Horizon: $env:INGEST_HORIZON_URL"
if ($env:INGEST_RPC_URL) {
    Write-Host "Soroban RPC: $env:INGEST_RPC_URL"
} else {
    Write-Host "Soroban RPC: not set. Classic transactions will ingest; Soroban trace enrichment requires -RpcUrl."
}

Push-Location $repoRoot
cargo run -p ingest
Pop-Location
