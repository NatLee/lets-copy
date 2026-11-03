# Local packaging for Windows — mirrors .github/workflows/build.yml.
# Compress-Archive in Windows PowerShell 5.1 stores paths with backslashes
# (icons\icon24.png), which other tools and the Web Store don't treat as
# folders, so entries are added one by one with forward slashes instead.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$manifest = Get-Content -Raw 'src/manifest.json' | ConvertFrom-Json
$version = $manifest.version
$name = "lets-copy-v$version.zip"
$out = Join-Path (Get-Location) $name
$src = (Resolve-Path 'src').Path

if (Test-Path $out) { Remove-Item $out -Force }

$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
    Get-ChildItem -Path $src -Recurse -File |
        Where-Object { $_.Name -ne '.DS_Store' -and $_.Extension -ne '.map' } |
        ForEach-Object {
            $entry = $_.FullName.Substring($src.Length + 1) -replace '\\', '/'
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry, 'Optimal')
        }
} finally {
    $zip.Dispose()
}

$size = (Get-Item $out).Length
$kb = [Math]::Round($size / 1KB, 1)
Write-Host "Built $name ($kb KB)"
