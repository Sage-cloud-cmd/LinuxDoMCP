#!/bin/bash
# linux.do MCP 安装（Mac）。用法：在终端里输入 bash 和一个空格，把这个文件拖进终端窗口，回车。
cd "$(dirname "$0")" || exit 1
# 去掉「从网上下载」的标记，否则系统会拦住程序运行
xattr -dr com.apple.quarantine . 2>/dev/null
chmod +x ./linuxdo-mcp
./linuxdo-mcp setup
