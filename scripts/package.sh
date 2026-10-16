#!/bin/bash
# 打给朋友的安装包：dist/linuxdo-mcp-mac-<版本>.zip、dist/linuxdo-mcp-windows-<版本>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(sed -n 's/^const VERSION = "\(.*\)";/\1/p' src/server.ts)
B=dist/build
rm -rf dist && mkdir -p $B
bun test
for t in darwin-arm64 darwin-x64; do bun build src/server.ts --compile --minify --target=bun-$t --outfile $B/$t/linuxdo-mcp; done
bun build src/server.ts --compile --minify --target=bun-windows-x64 --outfile $B/windows-x64/linuxdo-mcp.exe
# Mac：两种芯片合成一个通用程序，再做本机签名（交叉编译出的 Intel 版签名是坏的）
codesign --remove-signature $B/darwin-arm64/linuxdo-mcp; codesign --remove-signature $B/darwin-x64/linuxdo-mcp
lipo -create $B/darwin-arm64/linuxdo-mcp $B/darwin-x64/linuxdo-mcp -output $B/linuxdo-mcp-universal
codesign --force --sign - $B/linuxdo-mcp-universal

# 教程页：填上版本号；dist/guide-web.html 用来发布成网页，安装包里放补齐 <head> 的完整版 guide.html
sed "s/__VERSION__/$V/g" guide/guide.html > dist/guide-web.html
{ printf '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n'; cat dist/guide-web.html; printf '\n</body>\n</html>\n'; } > $B/guide.html

M=dist/linuxdo-mcp-mac-$V; W=dist/linuxdo-mcp-windows-$V
mkdir -p $M $W
cp $B/linuxdo-mcp-universal $M/linuxdo-mcp; cp packaging/install.sh $M/; cp packaging/README-mac.txt $M/README.txt; cp -R extension $M/; cp $B/guide.html $M/
cp $B/windows-x64/linuxdo-mcp.exe $W/; cp packaging/install.bat $W/; cp packaging/README-windows.txt $W/README.txt; cp -R extension $W/; cp $B/guide.html $W/
chmod +x $M/linuxdo-mcp $M/install.sh
(cd dist && ditto -c -k --keepParent linuxdo-mcp-mac-$V linuxdo-mcp-mac-$V.zip && zip -qr linuxdo-mcp-windows-$V.zip linuxdo-mcp-windows-$V)
rm -rf $B $M $W .*.bun-build  # 编译留下的临时文件也清掉
ls -lh dist
