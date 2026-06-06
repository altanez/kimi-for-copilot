# Kimi for Copilot - Installer
# Run: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [string]$ApiKey = ""
)

$ErrorActionPreference = "Stop"
Write-Host "=== Kimi for Copilot Installer ===" -ForegroundColor Cyan

$srcDir = "$PSScriptRoot"
$extName = "kimi-for-copilot"
$extDir = "$env:USERPROFILE\.vscode\extensions\local.$extName"

# --- Check prerequisites ---
Write-Host ""
Write-Host "[1/4] Checking prerequisites..." -ForegroundColor Yellow

# Check if extension files exist
if (-not (Test-Path "$srcDir\extension.js")) {
    Write-Host "ERROR: extension.js not found in $srcDir" -ForegroundColor Red
    Write-Host "Run this script from the kimi-for-copilot folder!" -ForegroundColor Red
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
    Write-Host "Or install extension manually by copying files." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Proceeding with manual copy installation instead..." -ForegroundColor Cyan
    $useManualInstall = $true
} else {
    $useManualInstall = $false
}

# --- Create VSIX package ---
Write-Host ""
Write-Host "[2/4] Creating VSIX package..." -ForegroundColor Yellow

if ($useManualInstall) {
    Write-Host "  Skipping VSIX (vsce not available)" -ForegroundColor Gray
} else {
    Push-Location $srcDir
    try {
        Write-Host "  Running: npx vsce package --no-dependencies" -ForegroundColor Gray
        $vsixFile = Invoke-Expression "npx vsce package --no-dependencies 2>&1"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  WARNING: vsce package failed: $vsixFile" -ForegroundColor Yellow
            $useManualInstall = $true
        } else {
            # Find the created .vsix file
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
}

# --- Install extension ---
Write-Host ""
Write-Host "[3/4] Installing extension..." -ForegroundColor Yellow

# Uninstall existing if present
$codeCmd = $null
if (Get-Command code -ErrorAction SilentlyContinue) { $codeCmd = "code" }
elseif (Get-Command "C:\Program Files\Microsoft VS Code\bin\code.cmd" -ErrorAction SilentlyContinue) { $codeCmd = "C:\Program Files\Microsoft VS Code\bin\code.cmd" }

if ($codeCmd -and -not $useManualInstall) {
    Write-Host "  Uninstalling old version if present..." -ForegroundColor Gray
    $null = Invoke-Expression "& $codeCmd --uninstall-extension local.$extName 2>&1"
    if ($vsix) {
        Write-Host "  Installing VSIX: $($vsix.FullName)" -ForegroundColor Gray
        $installResult = Invoke-Expression "& $codeCmd --install-extension `"$($vsix.FullName)`" 2>&1"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Extension installed via VSIX" -ForegroundColor Green
        } else {
            Write-Host "  VSIX install failed, falling back to manual copy: $installResult" -ForegroundColor Yellow
            $useManualInstall = $true
        }
    }
} else {
    $useManualInstall = $true
}

if ($useManualInstall) {
    New-Item -ItemType Directory -Path $extDir -Force | Out-Null
    Copy-Item "$srcDir\extension.js" $extDir -Force
    Copy-Item "$srcDir\package.json" $extDir -Force
    Write-Host "  Extension installed (manual copy) to $extDir" -ForegroundColor Green
}

# --- API Key ---
Write-Host ""
Write-Host "[4/4] Configuring API key..." -ForegroundColor Yellow

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

# --- 5. Check proxy access (for Russia) ---
Write-Host ""
Write-Host "[5/5] Checking connectivity..." -ForegroundColor Yellow

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
