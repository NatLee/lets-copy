#!/bin/bash
cp ./src/manifest.json ./manifest.json
zip -FSr package.zip ./manifest.json ./src.crx
rm ./manifest.json
