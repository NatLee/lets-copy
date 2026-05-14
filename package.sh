#!/usr/bin/env bash
# Local packaging — mirrors what .github/workflows/build.yml produces.
set -euo pipefail

VERSION=$(node -p "require('./src/manifest.json').version")
NAME="lets-copy-v${VERSION}.zip"

rm -f "$NAME"
(cd src && zip -r "../$NAME" . -x '.DS_Store' -x '__MACOSX*' -x '*.map')

echo "Built $NAME ($(du -h "$NAME" | cut -f1))"
