# fix-copilot-model-cache.ps1
# Clears state.vscdb cache (global + workspace) with backup.

$ErrorActionPreference = 'Stop'

# 1) VS Code must be closed
$running = Get-Process -Name Code -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Close all VS Code windows and run again." -ForegroundColor Yellow
    exit 1
}

$codeUser = Join-Path $env:APPDATA 'Code\User'
$globalStorage = Join-Path $codeUser 'globalStorage'
$workspaceStorage = Join-Path $codeUser 'workspaceStorage'

if (!(Test-Path $codeUser)) {
    Write-Host "Folder not found: $codeUser" -ForegroundColor Red
    exit 1
}

# 2) Backup folder
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $codeUser ("copilot-cache-backup-" + $stamp)
New-Item -ItemType Directory -Path $backupRoot | Out-Null

# 3) Collect target files
$targets = @()

$globalDb = Join-Path $globalStorage 'state.vscdb'
$globalBak = Join-Path $globalStorage 'state.vscdb.backup'
if (Test-Path $globalDb) { $targets += $globalDb }
if (Test-Path $globalBak) { $targets += $globalBak }

if (Test-Path $workspaceStorage) {
    $targets += Get-ChildItem -Path $workspaceStorage -Recurse -File -Filter 'state.vscdb' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
    $targets += Get-ChildItem -Path $workspaceStorage -Recurse -File -Filter 'state.vscdb.backup' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
}

$targets = $targets | Sort-Object -Unique

if (-not $targets -or $targets.Count -eq 0) {
    Write-Host "No state.vscdb files found. Nothing to clean." -ForegroundColor Yellow
    exit 0
}

Write-Host "Found files: $($targets.Count)"
Write-Host "Backup: $backupRoot"

# 4) Backup + delete
foreach ($file in $targets) {
    $safeName = ($file -replace '[:\\\/ ]','_')
    $dest = Join-Path $backupRoot $safeName
    Copy-Item -Path $file -Destination $dest -Force
    Remove-Item -Path $file -Force
    Write-Host "Removed: $file"
}

# 5) Fix activationEvents for installed local copilot extensions
$extDirs = @(
    (Join-Path $env:USERPROFILE '.vscode\extensions\local.kimi-for-copilot')
    (Join-Path $env:USERPROFILE '.vscode\extensions\local.opencode-for-copilot')
)
foreach ($extDir in $extDirs) {
    $pkgJson = Join-Path $extDir 'package.json'
    if (Test-Path $pkgJson) {
        $content = Get-Content $pkgJson -Raw
        if ($content -match '"activationEvents"\s*:\s*\[\s*"onStartupFinished"\s*\]') {
            $content = $content -replace '"activationEvents"\s*:\s*\[\s*"onStartupFinished"\s*\]', '"activationEvents": ["*"]'
            $content | Set-Content $pkgJson -NoNewline
            Write-Host "Fixed activationEvents in: $pkgJson" -ForegroundColor Cyan
        }
    }
}

Write-Host ""
Write-Host "Done. Start VS Code." -ForegroundColor Green
Write-Host "If OpenCode / Kimi models don't appear in the picker, reinstall the extensions:" -ForegroundColor Yellow
Write-Host "  1) Close VS Code" -ForegroundColor Gray
Write-Host "  2) Run install.ps1 from the opencode-for-copilot folder" -ForegroundColor Gray
Write-Host "  3) Run install.ps1 from the kimi-for-copilot folder" -ForegroundColor Gray
Write-Host "  4) Open VS Code" -ForegroundColor Gray
Write-Host ""
Write-Host "To rollback, copies are in: $backupRoot"