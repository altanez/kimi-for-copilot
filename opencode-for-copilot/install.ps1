# OpenCode Zen for Copilot - Installer
param([string]$ApiKey = "")
$ErrorActionPreference = "Stop"
Write-Host "=== OpenCode Zen for Copilot Installer ===" -ForegroundColor Cyan

$extDir = "$env:USERPROFILE\.vscode\extensions\local.opencode-for-copilot"
$srcDir = "$PSScriptRoot"

Write-Host "[1/3] Installing extension..." -ForegroundColor Yellow
if (-not (Test-Path "$srcDir\extension.js")) { Write-Host "ERROR: extension.js not found" -ForegroundColor Red; pause; exit 1 }
New-Item -ItemType Directory -Path $extDir -Force | Out-Null
Copy-Item "$srcDir\extension.js", "$srcDir\package.json" $extDir -Force
Write-Host "  Extension installed" -ForegroundColor Green

Write-Host "[2/3] Configuring API key..." -ForegroundColor Yellow
if (-not $ApiKey) { $ApiKey = Read-Host "  Enter your OpenCode Zen API key (from opencode.ai/auth)" }
if ($ApiKey) {
    $settingsPath = "$env:APPDATA\Code\User\settings.json"
    $settings = if (Test-Path $settingsPath) { Get-Content $settingsPath -Raw | ConvertFrom-Json } else { @{} }
    $settings | Add-Member -NotePropertyName "opencode-copilot.apiKey" -NotePropertyValue $ApiKey -Force
    $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath
    Write-Host "  API key saved" -ForegroundColor Green
} else { Write-Host "  WARNING: No key. Set `"opencode-copilot.apiKey`" in settings.json" -ForegroundColor Yellow }

Write-Host "[3/3] Models available:" -ForegroundColor Yellow
Write-Host "  deepseek-v4-flash, kimi-k2.6, kimi-k2.5, minimax-m2.7, glm-5.1, grok-build-0.1, big-pickle, mimo-v2.5-free, nemotron-3-ultra-free, qwen3.7-max, qwen3.7-plus" -ForegroundColor Gray

Write-Host "`n=== Done! Restart VS Code (Developer: Reload Window) ===" -ForegroundColor Cyan
pause
