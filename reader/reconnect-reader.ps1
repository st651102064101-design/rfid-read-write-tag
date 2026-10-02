$ErrorActionPreference = 'Stop'
$readerRoot = Split-Path $PSScriptRoot -Parent
$readerConfigPath = Join-Path $readerRoot '.sites-runtime/writer-config.xml'
$readerSecret = Import-Clixml -LiteralPath $readerConfigPath
$readerConfig = [System.Net.NetworkCredential]::new('', $readerSecret).Password
$readerConfig | & node (Join-Path $PSScriptRoot 'reconnect-reader.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Reader recovery did not confirm live tag delivery.' }
