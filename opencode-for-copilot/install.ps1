# OpenCode Zen for Copilot - Installer
# Run: powershell -ExecutionPolicy Bypass -File install.ps1
# Installs via .vsix package (recommended method)

param([string]$ApiKey = "")

$ErrorActionPreference = "Stop"
Write-Host "=== OpenCode Zen for Copilot Installer ===" -ForegroundColor Cyan

$srcDir = "$PSScriptRoot"
$extName = "opencode-for-copilot"
$extDir = "$env:USERPROFILE\.vscode\extensions\local.$extName"

# --- Check prerequisites ---
Write-Host ""
Write-Host "[1/4] Checking prerequisites..." -ForegroundColor Yellow

if (-not (Test-Path "$srcDir\extension.js")) {
    Write-Host "ERROR: extension.js not found in $srcDir" -ForegroundColor Red
    Write-Host "Run this script from the opencode-for-copilot folder!" -ForegroundColor Red
    pause
    exit 1
}

# Check for vsce
$vsceCmd = $null
if (Get-Command npx -ErrorAction SilentlyContinue) {
    try {
        $null = Invoke-Expression "npx vsce --version" 2>&1
        if ($LASTEXITCODE -eq 0) { $vsceCmd = "npx vsce" }
    } catch {}
}
if (-not $vsceCmd) {
    Write-Host "WARNING: vsce not found. Install with: npm install -g @vscode/vsce" -ForegroundColor Yellow
    Write-Host "Proceeding with manual copy installation instead..." -ForegroundColor Cyan
    $useManualInstall = $true
} else {
    $useManualInstall = $false
}

# --- Create VSIX package ---
Write-Host ""
Write-Host "[2/4] Creating VSIX package..." -ForegroundColor Yellow

$vsix = $null
if (-not $useManualInstall) {
    Push-Location $srcDir
    try {
        Write-Host "  Running: npx vsce package --no-dependencies" -ForegroundColor Gray
        $vsixFile = Invoke-Expression "npx vsce package --no-dependencies 2>&1"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  WARNING: vsce package failed: $vsixFile" -ForegroundColor Yellow
            $useManualInstall = $true
        } else {
            $vsix = Get-ChildItem "$srcDir\*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($vsix) {
                Write-Host "  Created: $($vsix.Name)" -ForegroundColor Green
            } else {
                $useManualInstall = $true
            }
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  Skipping VSIX (vsce not available)" -ForegroundColor Gray
}

# --- Install extension ---
Write-Host ""
Write-Host "[3/4] Installing extension..." -ForegroundColor Yellow

$codeCmd = $null
if (Get-Command code -ErrorAction SilentlyContinue) { $codeCmd = "code" }
elseif (Get-Command "C:\Program Files\Microsoft VS Code\bin\code.cmd" -ErrorAction SilentlyContinue) { $codeCmd = "C:\Program Files\Microsoft VS Code\bin\code.cmd" }

if ($codeCmd -and -not $useManualInstall -and $vsix) {
    Write-Host "  Uninstalling old version if present..." -ForegroundColor Gray
    $null = Invoke-Expression "& $codeCmd --uninstall-extension local.$extName 2>&1"
    Write-Host "  Installing VSIX: $($vsix.FullName)" -ForegroundColor Gray
    $installResult = Invoke-Expression "& $codeCmd --install-extension `"$($vsix.FullName)`" 2>&1"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Extension installed via VSIX" -ForegroundColor Green
    } else {
        Write-Host "  VSIX install failed, falling back to manual copy: $installResult" -ForegroundColor Yellow
        $useManualInstall = $true
    }
} else {
    $useManualInstall = $true
}

if ($useManualInstall) {
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
    Copy-Item "$srcDir\extension.js", "$srcDir\package.json" $extDir -Force
    Write-Host "  Extension installed (manual copy) to $extDir" -ForegroundColor Green
}

# --- API Key ---
Write-Host ""
Write-Host "[4/4] Configuring API key..." -ForegroundColor Yellow

if (-not $ApiKey) { $ApiKey = Read-Host "  Enter your OpenCode Zen API key (from opencode.ai/auth)" }
if ($ApiKey) {
    $settingsPath = "$env:APPDATA\Code\User\settings.json"
    $settings = if (Test-Path $settingsPath) { Get-Content $settingsPath -Raw | ConvertFrom-Json } else { @{} }
    $settings | Add-Member -NotePropertyName "opencode-copilot.apiKey" -NotePropertyValue $ApiKey -Force
    $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath
    Write-Host "  API key saved" -ForegroundColor Green
} else {
    Write-Host "  WARNING: No key. Set `"opencode-copilot.apiKey`" in settings.json" -ForegroundColor Yellow
}

# --- Done ---
Write-Host ""
Write-Host "=== Installation complete! ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Restart VS Code (Ctrl+Shift+P -> Developer: Reload Window)" -ForegroundColor Gray
Write-Host "  2. Open Copilot Chat, pick a model from the dropdown" -ForegroundColor Gray
Write-Host ""
pause
