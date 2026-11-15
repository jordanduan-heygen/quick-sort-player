@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\quick-sort-player.exe" (
  echo Not installed. Run setup.cmd first.
  exit /b 2
)
".venv\Scripts\quick-sort-player.exe" --no-reload %*
