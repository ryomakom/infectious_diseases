@echo off
echo Opening http://localhost:8000 in your browser...
echo Press Ctrl+C to stop the server.
echo.
cd /d "%~dp0"
python -m http.server 8000 2>nul || npx --yes serve -p 8000 .
