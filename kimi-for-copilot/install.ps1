# Kimi for Copilot - Installer
# Run: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [string]$ApiKey = ""
)

$ErrorActionPreference = "Stop"
Write-Host "=== Kimi for Copilot Installer ===" -ForegroundColor Cyan

# --- 1. Copy extension ---
$extDir = "$env:USERPROFILE\.vscode\extensions\local.kimi-for-copilot"
$srcDir = "$PSScriptRoot"

Write-Host ""
Write-Host "[1/3] Installing extension..." -ForegroundColor Yellow

if (-not (Test-Path "$srcDir\extension.js")) {
    Write-Host "ERROR: extension.js not found in $srcDir" -ForegroundColor Red
    Write-Host "Run this script from the kimi-for-copilot folder!" -ForegroundColor Red
    pause
    exit 1
}

New-Item -ItemType Directory -Path $extDir -Force | Out-Null
Copy-Item "$srcDir\extension.js" $extDir -Force
Copy-Item "$srcDir\package.json" $extDir -Force
Write-Host "  Extension installed to $extDir" -ForegroundColor Green

# --- 2. API Key ---
Write-Host ""
Write-Host "[2/3] Configuring API key..." -ForegroundColor Yellow

if (-not $ApiKey) {
    $ApiKey = Read-Host "  Enter your Kimi API key (sk-kimi-...)"
}

if (-not $ApiKey) {
    Write-Host "  WARNING: No API key provided. Set it later in VS Code:" -ForegroundColor Yellow
    Write-Host '    "kimi-copilot.apiKey": "YOUR_KEY"' -ForegroundColor Gray
} else {
    $settingsPath = "$env:APPDATA\Code\User\settings.json"
    $settings = @{}
    if (Test-Path $settingsPath) {
        $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        if (-not $settings) { $settings = @{} }
    } else {
        $settings = @{}
    }
    # Add the key as a property
    $settings | Add-Member -NotePropertyName "kimi-copilot.apiKey" -NotePropertyValue $ApiKey -Force
    $settings | ConvertTo-Json -Depth 10 | Set-Content $settingsPath
    Write-Host "  API key saved to VS Code settings" -ForegroundColor Green
}

# --- 3. Check proxy access (for Russia) ---
Write-Host ""
Write-Host "[3/3] Checking connectivity..." -ForegroundColor Yellow

try {
    $proxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy("https://api.kimi.com").AbsoluteUri
    if ($proxy -ne "https://api.kimi.com/") {
        Write-Host "  System proxy detected: $proxy" -ForegroundColor Green
        Write-Host "  Extension will auto-use it via HTTP CONNECT tunnel" -ForegroundColor Green
    } else {
        Write-Host "  No proxy detected: direct connection will be used" -ForegroundColor Green
    }
} catch {
    Write-Host "  Could not detect proxy - direct connection will be attempted" -ForegroundColor Yellow
}

# --- Done ---
Write-Host ""
Write-Host "=== Installation complete! ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Restart VS Code (Ctrl+Shift+P -> Developer: Reload Window)" -ForegroundColor Gray
Write-Host "  2. Open Copilot Chat, pick 'kimi-latest' from the model dropdown" -ForegroundColor Gray
Write-Host "  3. If you don't see Kimi models, check Help -> Toggle Developer Tools -> Console for errors" -ForegroundColor Gray
Write-Host ""

pause
