@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Remove the "downloaded from the internet" mark so Windows does not block the program
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Recurse | Unblock-File"
linuxdo-mcp.exe setup
echo.
pause
