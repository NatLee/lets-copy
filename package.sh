#!/bin/bash
rm package.zip
cp ./src/manifest.json ./manifest.json
cp ./src/background.js ./background.js
cp ./src/content.js ./content.js
cp ./src/enable.js ./enable.js
cp -r ./src/icons ./
zip -FSrj package.zip ./manifest.json ./src.crx ./icons
rm ./manifest.json
rm ./background.js
rm ./content.js
rm ./enable.js
rm src.crx src.pem
rm -r ./icons
