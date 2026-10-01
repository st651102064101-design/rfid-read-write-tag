$ErrorActionPreference = 'Stop'
$writerRoot = Split-Path $PSScriptRoot -Parent
$writerConfigPath = Join-Path $writerRoot '.sites-runtime/writer-config.xml'
if (!(Test-Path -LiteralPath $writerConfigPath)) { throw 'Writer configuration missing. Configure bridge for this Windows user first.' }
$writerSecret = Import-Clixml -LiteralPath $writerConfigPath
$writerConfig = [System.Net.NetworkCredential]::new('', $writerSecret).Password
Write-Host 'Starting local writer. Keep this process running while using the website.'
$writerConfig | & node (Join-Path $PSScriptRoot 'write-bridge.mjs')
