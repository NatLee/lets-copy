# release.ps1 — Tag the current manifest version and push it to origin.
# Aborts if the tag already exists locally or on origin (i.e. version was not bumped).
$ErrorActionPreference = 'Stop'

$manifest = Get-Content -Raw 'src/manifest.json' | ConvertFrom-Json
$version = $manifest.version
$tag = "v$version"

if (git tag --list $tag) {
    Write-Host "[release] Tag $tag already exists locally - bump src/manifest.json version before releasing." -ForegroundColor Red
    exit 1
}

if (git ls-remote --tags origin "refs/tags/$tag") {
    Write-Host "[release] Tag $tag already exists on origin - bump src/manifest.json version before releasing." -ForegroundColor Red
    exit 1
}

if (git status --porcelain) {
    Write-Host "[release] Working tree is not clean. Commit or stash changes first." -ForegroundColor Red
    exit 1
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$subject = (git log -1 --pretty=%s).Trim()
$message = "Release $tag`n`n$subject"

Write-Host "[release] Pushing branch $branch ..."
git push origin $branch
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[release] Creating annotated tag $tag ..."
git tag -a $tag -m $message
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[release] Pushing tag $tag ..."
git push origin $tag
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[release] Done - $tag released from $branch." -ForegroundColor Green
