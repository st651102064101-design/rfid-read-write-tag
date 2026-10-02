$ErrorActionPreference='Stop'
$relayRoot=Split-Path $PSScriptRoot -Parent
$relaySecret=Import-Clixml -LiteralPath (Join-Path $relayRoot '.sites-runtime/writer-config.xml')
$relayConfig=[System.Net.NetworkCredential]::new('', $relaySecret).Password
$relayConfig | & node (Join-Path $PSScriptRoot 'data-relay.mjs')
