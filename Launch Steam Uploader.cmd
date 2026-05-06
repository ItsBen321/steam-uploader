@echo off
setlocal

cd /d "%~dp0"
set "PROJECT_DIR=%cd%"
set "LOG_FILE=%PROJECT_DIR%\steam-uploader-launch.log"
set "ERR_FILE=%PROJECT_DIR%\steam-uploader-launch.err.log"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found on PATH. Install Node.js or use Launch Steam Uploader Debug.cmd from a terminal where npm works. > "%LOG_FILE%"
  start "" notepad.exe "%LOG_FILE%"
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$npm = (Get-Command npm.cmd).Source; Start-Process -FilePath $npm -ArgumentList @('run','dev') -WorkingDirectory '%PROJECT_DIR%' -WindowStyle Hidden -RedirectStandardOutput '%LOG_FILE%' -RedirectStandardError '%ERR_FILE%'"
