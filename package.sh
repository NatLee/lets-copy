#!/bin/bash
rm package.zip
cp ./src/manifest.json ./manifest.json
zip -FSr package.zip ./manifest.json ./src.crx
rm ./manifest.json
rm src.crx src.pem
