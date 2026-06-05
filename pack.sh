#!/bin/bash
# 打包扩展为 zip，排除无关文件
cd "$(dirname "$0")"
rm -f aihot-notifier.zip
zip -r aihot-notifier.zip \
  manifest.json \
  background.js \
  popup.html \
  popup.js \
  icons/ \
  -x "*.DS_Store"
echo "✓ 打包完成: aihot-notifier.zip"
ls -lh aihot-notifier.zip
