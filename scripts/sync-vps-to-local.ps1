param(
  [string]$VpsHost = "root@167.172.153.109",
  [string]$VpsAppDir = "/opt/saynext",
  [string]$VpsDataDir = "/opt/saynext/data",
  [string]$PublicHealthUrl = "https://saynext.167.172.153.109.sslip.io/api/health",
  [string]$LocalDbPath = "",
  [switch]$SwitchToLocalMode,
  [switch]$AllowLocalServerRunning,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"

function Run($Description, $ScriptBlock) {
  Write-Host "`n==> $Description"
  & $ScriptBlock
}

function Invoke-RemoteBash([string]$ScriptText) {
  $tempDir = Join-Path $env:TEMP "saynext-sync"
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
  $localScript = Join-Path $tempDir ("remote-" + [Guid]::NewGuid().ToString("N") + ".sh")
  $remoteScript = "/tmp/" + [IO.Path]::GetFileName($localScript)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($localScript, $ScriptText.Replace("`r`n", "`n"), $utf8NoBom)
  try {
    scp $localScript "${VpsHost}:$remoteScript"
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to upload remote script: $localScript"
    }
    ssh $VpsHost "bash '$remoteScript'; status=`$?; rm -f '$remoteScript'; exit `$status"
    if ($LASTEXITCODE -ne 0) {
      throw "Remote script failed with exit code $LASTEXITCODE"
    }
  } finally {
    Remove-Item -LiteralPath $localScript -Force -ErrorAction SilentlyContinue
  }
}

function Test-LocalPort3000 {
  try {
    $connection = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop | Select-Object -First 1
    return $null -ne $connection
  } catch {
    $output = netstat -ano | Select-String -Pattern ":3000\s+.*LISTENING"
    return $null -ne $output
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $LocalDbPath) {
  $LocalDbPath = Join-Path $repoRoot "data\saynext.sqlite"
}

if (-not $AllowLocalServerRunning -and (Test-LocalPort3000)) {
  throw "Local SayNext appears to be running on port 3000. Stop bun run dev before replacing the local database, or pass -AllowLocalServerRunning if you intentionally accept the risk."
}

$localDataDir = Split-Path $LocalDbPath -Parent
$dbName = Split-Path $LocalDbPath -Leaf
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $repoRoot "data\db-backups"
$localBackupDir = Join-Path $backupRoot "local-before-vps-pull-$timestamp"
$pullDir = Join-Path $backupRoot "vps-pull-stage-$timestamp"
$archivePath = Join-Path $backupRoot "saynext-vps-pull-$timestamp.tgz"
$remoteArchive = "/tmp/saynext-vps-pull-$timestamp.tgz"

Run "Create local backup/pull folders" {
  New-Item -ItemType Directory -Force -Path $backupRoot, $localBackupDir, $pullDir, $localDataDir | Out-Null
}

$remotePackage = @"
set -e
was_active=inactive
if systemctl is-active --quiet saynext; then was_active=active; fi
systemctl stop saynext 2>/dev/null || true
if [ ! -f '$VpsDataDir/$dbName' ]; then
  echo 'Missing VPS database: $VpsDataDir/$dbName' >&2
  exit 2
fi
mkdir -p '$VpsDataDir/backups/vps-before-local-pull-$timestamp'
cp -a '$VpsDataDir/$dbName'* '$VpsDataDir/backups/vps-before-local-pull-$timestamp/' 2>/dev/null || true
cd '$VpsDataDir'
files='$dbName'
[ -f '$dbName-wal' ] && files="`$files $dbName-wal"
[ -f '$dbName-shm' ] && files="`$files $dbName-shm"
tar -czf '$remoteArchive' `$files
echo `$was_active
"@

$remoteWasActive = ""
Run "Stop VPS app, back up VPS database, and package it" {
  $remoteWasActive = (Invoke-RemoteBash $remotePackage | Select-Object -Last 1).Trim()
  Write-Host "Previous VPS saynext state: $remoteWasActive"
}

Run "Download VPS database archive" {
  scp "${VpsHost}:$remoteArchive" $archivePath
}

Run "Back up current local database files" {
  if (Test-Path -LiteralPath $LocalDbPath) {
    Copy-Item -LiteralPath $LocalDbPath -Destination (Join-Path $localBackupDir $dbName) -Force
  }
  if (Test-Path -LiteralPath "$LocalDbPath-wal") {
    Copy-Item -LiteralPath "$LocalDbPath-wal" -Destination (Join-Path $localBackupDir "$dbName-wal") -Force
  }
  if (Test-Path -LiteralPath "$LocalDbPath-shm") {
    Copy-Item -LiteralPath "$LocalDbPath-shm" -Destination (Join-Path $localBackupDir "$dbName-shm") -Force
  }
}

Run "Install VPS database locally" {
  tar -xzf $archivePath -C $pullDir
  Remove-Item -LiteralPath $LocalDbPath, "$LocalDbPath-wal", "$LocalDbPath-shm" -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath (Join-Path $pullDir $dbName) -Destination $LocalDbPath -Force
  if (Test-Path -LiteralPath (Join-Path $pullDir "$dbName-wal")) {
    Copy-Item -LiteralPath (Join-Path $pullDir "$dbName-wal") -Destination "$LocalDbPath-wal" -Force
  }
  if (Test-Path -LiteralPath (Join-Path $pullDir "$dbName-shm")) {
    Copy-Item -LiteralPath (Join-Path $pullDir "$dbName-shm") -Destination "$LocalDbPath-shm" -Force
  }
}

Run "Restore requested VPS mode" {
  if ($SwitchToLocalMode) {
    $setLocalEnv = @"
set -e
cd '$VpsAppDir'
touch .env
tmp=".env.tmp"
grep -v -E '^(SAYNEXT_RUNTIME_MODE|SESSION_MEMORY_PROVIDER|SESSION_MEMORY_BATCH_ENABLED)=' .env > "`$tmp" || true
mv "`$tmp" .env
cat >> .env <<'EOF'
SAYNEXT_RUNTIME_MODE=local
SESSION_MEMORY_PROVIDER=ollama
SESSION_MEMORY_BATCH_ENABLED=false
EOF
chmod 600 .env
"@
    Invoke-RemoteBash $setLocalEnv
    ssh $VpsHost "saynext-local-mode && saynext-mode-status"
  } elseif ($remoteWasActive -eq "active") {
    ssh $VpsHost "systemctl start saynext && saynext-mode-status"
  } else {
    ssh $VpsHost "saynext-mode-status"
  }
  ssh $VpsHost "rm -f '$remoteArchive'"
}

if (-not $SkipHealthCheck -and -not $SwitchToLocalMode) {
  Run "Check public health" {
    curl.exe --ssl-no-revoke $PublicHealthUrl
  }
} elseif (-not $SkipHealthCheck) {
  Write-Host "`nSkipping public health check because VPS is now in local mode and local SayNext should still be stopped."
  Write-Host "Start local bun run dev and frpc, then run:"
  Write-Host "curl.exe --ssl-no-revoke $PublicHealthUrl"
}

Write-Host "`nVPS -> Local database sync complete."
Write-Host "Local backup: $localBackupDir"
Write-Host "Downloaded archive: $archivePath"
