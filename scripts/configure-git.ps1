$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    $expectedRemote = 'https://github.com/st651102064101-design/rfid-read-write-tag.git'
    $remotes = @(git remote)
    if ($remotes -notcontains 'origin') {
        if ($remotes -contains 'github') {
            git remote rename github origin
        } else {
            git remote add origin $expectedRemote
        }
        if ($LASTEXITCODE -ne 0) { throw 'Could not configure GitHub remote.' }
    }
    $actualRemote = git remote get-url origin
    if ($actualRemote -ne $expectedRemote) { throw 'Existing origin points elsewhere. Preserve it and review the remote before continuing.' }
    # Sites uses an ephemeral Bearer token supplied by its publishing workflow.
    # Do not launch Git Credential Manager for the internal Sites host.
    git config --local credential.https://git.chatgpt-team.site.helper ''
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure Sites credential helper.' }
    git config --local credential.https://git.chatgpt-team.site.interactive never
    if ($LASTEXITCODE -ne 0) { throw 'Could not disable interactive Sites credentials.' }
    git config --local remote.pushDefault origin
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure default push remote.' }
    Write-Host 'GitHub origin configured. Sites password prompts disabled for this checkout.'
} finally {
    Pop-Location
}
