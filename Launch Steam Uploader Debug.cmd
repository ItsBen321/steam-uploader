@echo off
setlocal

cd /d "%~dp0"
echo Starting Steam Uploader from:
echo %cd%
echo.
echo This debug window stays open so startup errors are visible.
echo.

call npm run dev

echo.
echo Steam Uploader stopped with exit code %ERRORLEVEL%.
pause
