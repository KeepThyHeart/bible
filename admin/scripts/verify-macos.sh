#!/bin/sh
# admin/scripts/verify-macos.sh -- verify a commit on macOS.
#
# Sets the repository up from scratch, runs the type checks and every unit
# test, builds both apps and starts each one, then prints PASSED or FAILED
# with the details of anything that failed. Logs and a summary.txt to attach
# to a sign-off are written to a directory it names.
#
#   admin/scripts/verify-macos.sh                 verify this checkout, in place
#   admin/scripts/verify-macos.sh --fresh         verify a fresh clone of this checkout's HEAD
#   admin/scripts/verify-macos.sh --fresh=https://github.com/KeepThyHeart/bible.git --ref=main_installation
#   admin/scripts/verify-macos.sh --help          every option
#
# This script checks what Node cannot check for itself (that Node, npm and git
# are there at all) and then runs admin/scripts/verify.js, which does the work.
# Needs: the Xcode Command Line Tools (for git, and to compile a native module
# when no prebuilt binary fits), Node.js 20.19 or newer (24 recommended).
#
# Written in plain sh so it runs under the /bin/sh that every macOS ships.

set -u

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH='' cd -- "$here/../.." && pwd)

fail() {
  printf '\nverify-macos: %s\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "this is the macOS script. On Linux run admin/scripts/verify-linux.sh; on Windows, admin\\scripts\\verify-windows.cmd."

if ! xcode-select -p >/dev/null 2>&1; then
  fail "the Xcode Command Line Tools are not installed. Run 'xcode-select --install', then run this again."
fi
command -v git >/dev/null 2>&1 || fail "git is not installed. Run 'xcode-select --install'."

# nvm puts node on PATH only in interactive shells; load it when node is missing.
if ! command -v node >/dev/null 2>&1; then
  nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$nvm_sh" ]; then
    # shellcheck disable=SC1090
    . "$nvm_sh" >/dev/null 2>&1
    (cd "$repo" && nvm use --silent >/dev/null 2>&1) || nvm use --silent default >/dev/null 2>&1 || true
  fi
fi
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node 24: 'brew install node@24', nvm ('nvm install 24'), or https://nodejs.org/."
command -v npm >/dev/null 2>&1 || fail "npm is not on PATH. It comes with Node.js; reinstall Node 24."

node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' \
  || fail "Node.js $(node --version) is too old: 20.19 or newer is needed (24 is recommended)."

command -v python3 >/dev/null 2>&1 \
  || echo "Note: python3 not found. Only needed if a native module has to compile."

exec node "$here/verify.js" "$@"
