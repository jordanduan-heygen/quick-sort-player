$Executable = "$PSScriptRoot\.venv\Scripts\quick-sort-player.exe"
if (-not (Test-Path $Executable)) {
    Write-Error "Not installed. Run .\setup.cmd first."
    exit 2
}
& $Executable @args
exit $LASTEXITCODE
