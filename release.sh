#!/usr/bin/env bash
# release.sh — Tag the current manifest version and push it to origin.
# Aborts if the tag already exists locally or on origin (i.e. version was not bumped).
set -euo pipefail

VERSION=$(node -p "require('./src/manifest.json').version")
TAG="v${VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "[release] Tag $TAG already exists locally - bump src/manifest.json version before releasing." >&2
  exit 1
fi

if git ls-remote --tags origin "refs/tags/$TAG" | grep -q "refs/tags/$TAG"; then
  echo "[release] Tag $TAG already exists on origin - bump src/manifest.json version before releasing." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "[release] Working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
SUBJECT=$(git log -1 --pretty=%s)

echo "[release] Pushing branch $BRANCH ..."
git push origin "$BRANCH"

echo "[release] Creating annotated tag $TAG ..."
git tag -a "$TAG" -m "Release $TAG

$SUBJECT"

echo "[release] Pushing tag $TAG ..."
git push origin "$TAG"

echo "[release] Done - $TAG released from $BRANCH."
