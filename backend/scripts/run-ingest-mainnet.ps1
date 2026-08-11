param(
    [string]$RpcUrl = "",
    [int]$MaxLedgersPerPass = 50
)

& "$PSScriptRoot\run-ingest-network.ps1" -Network mainnet -RpcUrl $RpcUrl -MaxLedgersPerPass $MaxLedgersPerPass
