#!/bin/sh
# admin/scripts/verify-linux.sh -- verify a commit on Linux.
#
# Sets the repository up from scratch, runs the type checks and every unit
# test, builds both apps and starts each one, then prints PASSED or FAILED
# with the details of anything that failed. Logs and a summary.txt to attach
# to a sign-off are written to a directory it names.
#
#   admin/scripts/verify-linux.sh                 verify this checkout, in place
#   admin/scripts/verify-linux.sh --fresh         verify a fresh clone of this checkout's HEAD
#   admin/scripts/verify-linux.sh --fresh=https://github.com/KeepThyHeart/bible.git --ref=main_installation
#   admin/scripts/verify-linux.sh --help          every option
#
# This script checks what Node cannot check for itself (that Node, npm and git
# are there at all) and then runs admin/scripts/verify.js, which does the work.
# Needs: git, Node.js 20.19 or newer (24 recommended), and, for the desktop
# checks without a desktop session, xvfb-run.

set -u

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH='' cd -- "$here/../.." && pwd)

fail() {
  printf '\nverify-linux: %s\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = "Linux" ] || fail "this is the Linux script. On macOS run admin/scripts/verify-macos.sh; on Windows, admin\\scripts\\verify-windows.cmd."

command -v git >/dev/null 2>&1 || fail "git is not installed (Debian/Ubuntu: sudo apt install git; Fedora: sudo dnf install git)."

# nvm puts node on PATH only in interactive shells; load it when node is missing.
if ! command -v node >/dev/null 2>&1; then
  nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$nvm_sh" ]; then
    # shellcheck disable=SC1090
    . "$nvm_sh" >/dev/null 2>&1
    (cd "$repo" && nvm use --silent >/dev/null 2>&1) || nvm use --silent default >/dev/null 2>&1 || true
  fi
fi
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node 24: with nvm, 'nvm install 24'; or see https://nodejs.org/."
command -v npm >/dev/null 2>&1 || fail "npm is not on PATH. It comes with Node.js; reinstall Node 24."

node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' \
  || fail "Node.js $(node --version) is too old: 20.19 or newer is needed (24 is recommended; 'nvm install 24')."

# Native modules normally download prebuilt binaries and only compile when
# that fails, so missing build tools are worth a note, not a stop.
missing=""
for tool in python3 make g++; do
  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "Note: not found:$missing. Only needed if a native module has to compile"
  echo "      (Debian/Ubuntu: sudo apt install build-essential python3)."
fi

if [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && ! command -v xvfb-run >/dev/null 2>&1; then
  case " $* " in
    *" --apps=web "*) ;;
    *) echo "Note: no display and no xvfb-run, so the desktop app cannot be started and that check will fail."
       echo "      Install xvfb (Debian/Ubuntu: sudo apt install xvfb), run from a desktop session, or pass --apps=web." ;;
  esac
fi

exec node "$here/verify.js" "$@"
