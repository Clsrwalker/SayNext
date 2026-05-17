param(
  [string]$VpsHost = "root@167.172.153.109",
  [string]$VpsAppDir = "/opt/saynext",
  [switch]$SkipInstall,
  [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

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
