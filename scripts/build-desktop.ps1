# Build the plotlint Studio desktop app on this PC.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-desktop.ps1
#
# Leaves desktop\release\plotlint-Studio-Setup-<version>.exe (installer) and
# desktop\release\plotlint-Studio-<version>-portable.exe. -Run opens the
# unpacked app straight away instead. -SkipPull uses the code as it is.
param([switch]$Run, [switch]$SkipPull)

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

function Step([string]$title, [scriptblock]$command) {
  Write-Host "`n== $title" -ForegroundColor Cyan
  & $command
  if ($LASTEXITCODE -ne 0) { throw "$title failed (exit code $LASTEXITCODE)" }
}

# The lockfile is pnpm 9's (as in CI); run that version whatever is installed.
function pnpm9 { npx.cmd -y pnpm@9.15.9 @args }

if (-not $SkipPull) {
  Step "Switch to master" { git switch master }
  Step "Pull the latest master" { git pull --ff-only origin master }
}
Step "Install dependencies" { $env:CI = "true"; pnpm9 install --frozen-lockfile; $code = $LASTEXITCODE; Remove-Item Env:CI; $global:LASTEXITCODE = $code }
Step "Build" { pnpm9 build }
Set-Location (Join-Path $repo "desktop")
Step "Install desktop tools" { npm.cmd ci }
Step "Build the app" { npm.cmd run dist }
if ($Run) {
  Step "Open plotlint Studio" { & ".\release\win-unpacked\plotlint Studio.exe" }
} else {
  Write-Host "`nDone. Installers are in $(Join-Path $repo 'desktop\release')" -ForegroundColor Green
}
