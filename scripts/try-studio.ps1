# Pull the latest plotlint, build it, make the test book and open Studio on it.
#
#   powershell -ExecutionPolicy Bypass -File scripts\try-studio.ps1
#
# -Project <dir> puts the test project somewhere else (default: .plotlint-demo
# in the repo, which git ignores). -Port changes Studio's port. -SkipPull uses
# the code as it is. Running it again resets the test book.
param([string]$Project = "", [int]$Port = 4567, [switch]$SkipPull)

$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
if (-not $Project) { $Project = Join-Path $repo ".plotlint-demo" }

function Step([string]$title, [scriptblock]$command) {
  Write-Host "`n== $title" -ForegroundColor Cyan
  & $command
  if ($LASTEXITCODE -ne 0) { throw "$title failed (exit code $LASTEXITCODE)" }
}

# The lockfile is pnpm 9's (as in CI); pnpm 10 refuses it, so run that version whatever is installed.
# npx.cmd, not npx: npm's npx.ps1 rebuilds its arguments from the calling line, which loses @args.
function pnpm9 { npx.cmd -y pnpm@9.15.9 @args }

if (-not $SkipPull) {
  Step "Switch to master" { git switch master }
  Step "Pull the latest master" { git pull --ff-only origin master }
}
# CI=true lets pnpm replace a node_modules folder made by another pnpm version
# without asking, which it cannot do from a script.
Step "Install dependencies" { $env:CI = "true"; pnpm9 install --frozen-lockfile; $code = $LASTEXITCODE; Remove-Item Env:CI; $global:LASTEXITCODE = $code }
Step "Build" { pnpm9 build }
Step "Make the test book" { node scripts/demo-book.mjs $Project }
Step "Open Studio (Ctrl+C to stop)" { node packages/cli/dist/index.js studio --project $Project --port $Port }
