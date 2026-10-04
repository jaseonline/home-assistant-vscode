<#
.SYNOPSIS
    Compiles and packages the home-assistant-vscode extension into a .vsix.

.DESCRIPTION
    Runs `npm run compile` (theme -> language-service -> schemas -> extension
    bundle), then packages with `vsce package --no-dependencies`; the bundle in
    out/ already contains the runtime dependencies. The .vsix is named from the
    version in package.json and written to the repo root. Optionally installs
    it into VS Code.

.PARAMETER SkipCompile
    Package the existing out/ folder without recompiling.

.PARAMETER Install
    Install the packaged .vsix into VS Code (reload the window afterwards).

.EXAMPLE
    .\build.ps1
    .\build.ps1 -Install
#>
[CmdletBinding()]
param(
    [switch]$SkipCompile,
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot

try {
    $version = (Get-Content -Path 'package.json' -Raw | ConvertFrom-Json).version
    $vsixName = "home-assistant-vscode-$version.vsix"

    if (-not $SkipCompile) {
        Write-Host "Compiling extension v$version..." -ForegroundColor Cyan
        npm run compile
        if ($LASTEXITCODE -ne 0) { throw "npm run compile failed (exit $LASTEXITCODE)" }
    }

    Write-Host "Packaging $vsixName..." -ForegroundColor Cyan
    if (Test-Path -Path $vsixName) {
        Remove-Item -Path $vsixName -Force
    }
    npx --yes @vscode/vsce package --no-dependencies -o $vsixName
    if ($LASTEXITCODE -ne 0) { throw "vsce package failed (exit $LASTEXITCODE)" }

    # Guard against session-memory notes leaking into the package again (1.1.14 near-miss)
    $leaked = npx --yes @vscode/vsce ls --no-dependencies | Where-Object { $_ -match '^\.(remember|claude)/' }
    if ($leaked) { throw "Package contains private files: $($leaked -join ', ') - update .vscodeignore" }

    if ($Install) {
        Write-Host "Installing $vsixName into VS Code..." -ForegroundColor Cyan
        code --install-extension $vsixName --force
        if ($LASTEXITCODE -ne 0) { throw "code --install-extension failed (exit $LASTEXITCODE)" }
        Write-Host 'Installed - run "Developer: Reload Window" to load it.' -ForegroundColor Green
    }

    Write-Host "Built $vsixName" -ForegroundColor Green
    Get-Item -Path $vsixName
}
catch {
    Write-Host "Build failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
