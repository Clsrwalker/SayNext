param(
  [string]$VpsHost = "root@167.172.153.109",
  [string]$VpsAppDir = "/opt/saynext",
  [switch]$SkipInstall,
  [switch]$NoRestart,
  [switch]$ForceArchiveDeploy
)

$ErrorActionPreference = "Stop"

function Run($Description, $ScriptBlock) {
  Write-Host "`n==> $Description"
  & $ScriptBlock
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $repoRoot "data\db-backups"
$archivePath = Join-Path $backupRoot "saynext-code-$timestamp.tgz"
$remoteArchive = "/tmp/saynext-code-$timestamp.tgz"

$remoteIsGit = $false
if (-not $ForceArchiveDeploy) {
  $remoteIsGitText = (ssh $VpsHost "test -d '$VpsAppDir/.git' && echo yes || echo no").Trim()
  $remoteIsGit = $remoteIsGitText -eq "yes"
}

if ($remoteIsGit) {
  $installCommand = "bun install"
  if ($SkipInstall) {
    $installCommand = "echo 'Skipping bun install'"
  }

  $restartCommand = @"
if systemctl is-active --quiet saynext; then
  systemctl restart saynext
else
  echo 'saynext service is not active; not restarting'
fi
"@

  if ($NoRestart) {
    $restartCommand = "echo 'Skipping saynext restart'"
  }

  $remoteScript = @"
set -e
cd '$VpsAppDir'
git pull --ff-only
$installCommand
$restartCommand
saynext-mode-status
"@

  ssh $VpsHost $remoteScript
  exit $LASTEXITCODE
}

Run "Build local committed-code archive" {
  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  git -C $repoRoot archive --format=tar.gz -o $archivePath HEAD
}

Run "Upload code archive to VPS" {
  scp $archivePath "${VpsHost}:$remoteArchive"
}

$remoteInstall = @"
set -e
was_active=inactive
if systemctl is-active --quiet saynext; then was_active=active; fi
systemctl stop saynext 2>/dev/null || true
mkdir -p /opt/saynext-backups
if [ -d '$VpsAppDir' ]; then
  tar -czf "/opt/saynext-backups/code-before-update-$timestamp.tgz" \
    -C '$VpsAppDir' \
    --exclude='./data' \
    --exclude='./node_modules' \
    --exclude='./.env' \
    . 2>/dev/null || true
fi
mkdir -p '$VpsAppDir'
tar -xzf '$remoteArchive' -C '$VpsAppDir'
rm -f '$remoteArchive'
cd '$VpsAppDir'
if [ -f .env ]; then chmod 600 .env; fi
"@

if ($SkipInstall) {
  $remoteInstall += "`necho 'Skipping bun install'`n"
} else {
  $remoteInstall += "`nbun install`n"
}

if ($NoRestart) {
  $remoteInstall += "echo 'Skipping saynext restart'`n"
} else {
  $remoteInstall += @"
if [ "`$was_active" = "active" ]; then
  systemctl start saynext
else
  echo 'saynext service was not active; not starting'
fi
"@
}

$remoteInstall += "`nsaynext-mode-status`n"

Run "Install archive on VPS" {
  ssh $VpsHost $remoteInstall
}

Write-Host "`nVPS code update complete."
Write-Host "Archive: $archivePath"
