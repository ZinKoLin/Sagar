$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$bridgePython = Join-Path $bridgeRoot '.venv-sagar-bridge\Scripts\python.exe'
if (!(Test-Path -LiteralPath $bridgePython)) {
    throw 'Install the Python bridge dependencies first. See docs/ai-studio-browser-bridge.md.'
}
Set-Location -LiteralPath $bridgeRoot
& $bridgePython -u (Join-Path $PSScriptRoot 'sagar_ai_studio_bridge.py')
