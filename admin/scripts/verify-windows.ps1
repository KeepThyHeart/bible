<#
.SYNOPSIS
  Verify a commit on Windows.

.DESCRIPTION
  Sets the repository up from scratch, runs the type checks and every unit
  test, builds both apps and starts each one, then prints PASSED or FAILED
  with the details of anything that failed. Logs and a summary.txt to attach
  to a sign-off are written to a directory it names.

  This script checks what Node cannot check for itself (that Node, npm and git
  are there at all) and then runs admin\scripts\verify.js, which does the work.
  Needs: git, Node.js 20.19 or newer (24 recommended; nvm-windows: nvm install 24).

  From cmd, or to avoid changing the execution policy, run verify-windows.cmd,
  which starts this script with -ExecutionPolicy Bypass.

.EXAMPLE
  admin\scripts\verify-windows.cmd
  Verify this checkout, in place.

.EXAMPLE
  admin\scripts\verify-windows.cmd --fresh
  Verify a fresh clone of this checkout's HEAD commit.

.EXAMPLE
  admin\scripts\verify-windows.cmd --fresh=https://github.com/KeepThyHeart/bible.git --ref=main_installation

.EXAMPLE
  admin\scripts\verify-windows.cmd --help
  Every option.
#>

# No param() block: every argument is passed through to verify.js untouched.
$ErrorActionPreference = 'Stop'

function Fail([string] $Message) {
  Write-Host ''
  Write-Host "verify-windows: $Message" -ForegroundColor Red
  exit 1
}

if ($env:OS -ne 'Windows_NT') {
  Fail 'this is the Windows script. On Linux run admin/scripts/verify-linux.sh; on macOS, admin/scripts/verify-macos.sh.'
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail 'git is not installed. Install Git for Windows (https://git-scm.com/download/win or: winget install Git.Git), then open a new terminal.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js is not installed. Install Node 24 (nvm-windows: nvm install 24, then nvm use 24; or winget install OpenJS.NodeJS.LTS), then open a new terminal.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail 'npm is not on PATH. It comes with Node.js; reinstall Node 24.'
}

& node -e 'const [a,b]=process.versions.node.split(\".\").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)'
if ($LASTEXITCODE -ne 0) {
  $version = & node --version
  Fail "Node.js $version is too old: 20.19 or newer is needed (24 is recommended; nvm-windows: nvm install 24)."
}

# Long paths: npm's node_modules nests deeply, and some tools fail past 260
# characters when long-path support is off. A note, not a stop.
try {
  $longPaths = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction Stop).LongPathsEnabled
  if ($longPaths -ne 1) {
    Write-Host 'Note: Windows long-path support is off. If a step fails on a path over 260 characters, turn it on'
    Write-Host '      (as administrator: reg add HKLM\SYSTEM\CurrentControlSet\Control\FileSystem /v LongPathsEnabled /t REG_DWORD /d 1 /f)'
    Write-Host '      or verify from a short directory, e.g. --work-dir=C:\v'
  }
} catch {
  # Not readable; nothing to say.
}

# Native modules normally download prebuilt binaries and only compile when
# that fails, which needs Visual Studio Build Tools. A note, not a stop.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) {
  Write-Host 'Note: Visual Studio Build Tools were not found. Only needed if a native module has to compile'
  Write-Host '      (the "Desktop development with C++" workload, plus Python 3).'
}

$verify = Join-Path $PSScriptRoot 'verify.js'
& node $verify @args
exit $LASTEXITCODE
