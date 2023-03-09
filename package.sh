#!/bin/bash
rm package.zip
cp ./src/manifest.json ./manifest.json
cp -r ./src/icons ./
zip -FSr package.zip ./manifest.json ./src.crx ./icons
rm ./manifest.json
rm src.crx src.pem
rm -r ./icons
