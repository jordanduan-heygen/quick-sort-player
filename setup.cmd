@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m venv --clear .venv
) else (
  where python >nul 2>nul || (
    echo Python 3.11 or newer is required: https://python.org/downloads/
    exit /b 2
  )
  python -m venv --clear .venv
)
if errorlevel 1 exit /b %errorlevel%
.venv\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 exit /b %errorlevel%
.venv\Scripts\python.exe -m pip install -e ".[dev]"
if errorlevel 1 exit /b %errorlevel%
echo Installed. Launch with run.cmd
