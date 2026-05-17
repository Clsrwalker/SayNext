param(
  [string]$VpsHost = "root@167.172.153.109",
  [string]$VpsAppDir = "/opt/saynext",
  [string]$VpsDataDir = "/opt/saynext/data",
  [string]$PublicHealthUrl = "https://saynext.167.172.153.109.sslip.io/api/health",
  [string]$LocalDbPath = "",
  [switch]$SwitchToTravelMode,
  [switch]$AllowLocalServerRunning,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"

function Run($Description, $ScriptBlock) {
  Write-Host "`n==> $Description"
  & $ScriptBlock
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

$commonBunPath = Join-Path $env:USERPROFILE ".bun\bin"
if ((Test-Path -LiteralPath $commonBunPath) -and ($env:Path -notlike "*$commonBunPath*")) {
  $env:Path += ";$commonBunPath"
}

if (-not (Test-Path -LiteralPath $LocalDbPath)) {
  throw "Local database not found: $LocalDbPath"
}

if (-not $AllowLocalServerRunning -and (Test-LocalPort3000)) {
  throw "Local SayNext appears to be running on port 3000. Stop bun run dev before syncing, or pass -AllowLocalServerRunning if you intentionally accept the risk."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $repoRoot "data\db-backups"
$localBackupDir = Join-Path $backupRoot "local-before-vps-push-$timestamp"
$stageDir = Join-Path $backupRoot "push-stage-$timestamp"
$archivePath = Join-Path $backupRoot "saynext-local-push-$timestamp.tgz"
$remoteArchive = "/tmp/saynext-local-push-$timestamp.tgz"
$dbName = Split-Path $LocalDbPath -Leaf
$localWal = "$LocalDbPath-wal"
$localShm = "$LocalDbPath-shm"

Run "Create local backup/stage folders" {
  New-Item -ItemType Directory -Force -Path $localBackupDir, $stageDir | Out-Null
}

Run "Checkpoint local SQLite WAL when Bun is available" {
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if ($bun) {
    try {
      & bun -e "import { Database } from 'bun:sqlite'; const db = new Database(process.argv[1]); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();" $LocalDbPath
    } catch {
      Write-Warning "SQLite checkpoint failed. Stop local SayNext before syncing if this database is actively being written."
    }
  } else {
    Write-Warning "bun is not on PATH. Skipping SQLite checkpoint."
  }
}

Run "Back up local database files" {
  Copy-Item -LiteralPath $LocalDbPath -Destination (Join-Path $localBackupDir $dbName) -Force
  if (Test-Path -LiteralPath $localWal) {
    Copy-Item -LiteralPath $localWal -Destination (Join-Path $localBackupDir "$dbName-wal") -Force
  }
  if (Test-Path -LiteralPath $localShm) {
    Copy-Item -LiteralPath $localShm -Destination (Join-Path $localBackupDir "$dbName-shm") -Force
  }
}

Run "Build local database archive" {
  Copy-Item -LiteralPath $LocalDbPath -Destination (Join-Path $stageDir $dbName) -Force
  if (Test-Path -LiteralPath $localWal) {
    Copy-Item -LiteralPath $localWal -Destination (Join-Path $stageDir "$dbName-wal") -Force
  }
  if (Test-Path -LiteralPath $localShm) {
    Copy-Item -LiteralPath $localShm -Destination (Join-Path $stageDir "$dbName-shm") -Force
  }
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  tar -czf $archivePath -C $stageDir .
}

$remotePrepare = @"
set -e
was_active=inactive
if systemctl is-active --quiet saynext; then was_active=active; fi
systemctl stop saynext 2>/dev/null || true
mkdir -p '$VpsDataDir/backups'
if [ -f '$VpsDataDir/$dbName' ]; then
  mkdir -p '$VpsDataDir/backups/vps-before-local-push-$timestamp'
  cp -a '$VpsDataDir/$dbName'* '$VpsDataDir/backups/vps-before-local-push-$timestamp/' 2>/dev/null || true
fi
echo `$was_active
"@

$remoteWasActive = ""
Run "Stop VPS app and back up current VPS database" {
  $remoteWasActive = (ssh $VpsHost $remotePrepare).Trim()
  Write-Host "Previous VPS saynext state: $remoteWasActive"
}

Run "Upload local database archive to VPS" {
  scp $archivePath "${VpsHost}:$remoteArchive"
}

$remoteInstall = @"
set -e
mkdir -p '$VpsDataDir'
rm -f '$VpsDataDir/$dbName' '$VpsDataDir/$dbName-wal' '$VpsDataDir/$dbName-shm'
tar -xzf '$remoteArchive' -C '$VpsDataDir'
rm -f '$remoteArchive'
chmod 600 '$VpsDataDir/$dbName' 2>/dev/null || true
"@

Run "Install uploaded database on VPS" {
  ssh $VpsHost $remoteInstall
}

Run "Restore requested VPS mode" {
  if ($SwitchToTravelMode) {
    $setTravelEnv = @"
set -e
cd '$VpsAppDir'
touch .env
set_env() {
  key="`$1"
  value="`$2"
  if grep -q "^`$key=" .env; then
    sed -i "s|^`$key=.*|`$key=`$value|" .env
  else
    printf '\n%s=%s\n' "`$key" "`$value" >> .env
  fi
}
set_env SAYNEXT_RUNTIME_MODE travel
set_env LLM_PROVIDER openai
set_env SESSION_MEMORY_PROVIDER openai
set_env SESSION_MEMORY_BATCH_ENABLED false
"@
    ssh $VpsHost $setTravelEnv
    ssh $VpsHost "saynext-travel-mode && saynext-mode-status"
  } elseif ($remoteWasActive -eq "active") {
    ssh $VpsHost "systemctl start saynext && saynext-mode-status"
  } else {
    ssh $VpsHost "saynext-mode-status"
  }
}

if (-not $SkipHealthCheck -and ($SwitchToTravelMode -or $remoteWasActive -eq "active")) {
  Run "Check public health" {
    curl.exe --ssl-no-revoke $PublicHealthUrl
  }
} elseif (-not $SkipHealthCheck) {
  Write-Host "`nSkipping public health check because VPS saynext is not active. Start the local app/frpc first, then run:"
  Write-Host "curl.exe --ssl-no-revoke $PublicHealthUrl"
}

Write-Host "`nLocal -> VPS database sync complete."
Write-Host "Local backup: $localBackupDir"
Write-Host "Archive: $archivePath"
