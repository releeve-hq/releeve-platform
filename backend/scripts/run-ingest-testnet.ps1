param(
    [int]$MaxLedgersPerPass = 50
)

& "$PSScriptRoot\run-ingest-network.ps1" -Network testnet -MaxLedgersPerPass $MaxLedgersPerPass
