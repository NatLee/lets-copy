# Local packaging for Windows — mirrors .github/workflows/build.yml.
$ErrorActionPreference = 'Stop'

$manifest = Get-Content -Raw 'src/manifest.json' | ConvertFrom-Json
$version = $manifest.version
$name = "lets-copy-v$version.zip"

if (Test-Path $name) { Remove-Item $name -Force }

Compress-Archive -Path 'src/*' -DestinationPath $name -Force

$size = (Get-Item $name).Length
$kb = [Math]::Round($size / 1KB, 1)
Write-Host "Built $name ($kb KB)"
