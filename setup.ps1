$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot

if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -m venv --clear "$ProjectDir\.venv"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -m venv --clear "$ProjectDir\.venv"
} else {
    throw "Python 3.11 or newer is required. Install it from https://python.org/downloads/"
}

$Python = "$ProjectDir\.venv\Scripts\python.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install -e "${ProjectDir}[dev]"
Write-Host "Installed. Launch with .\run.cmd"
