; ---------------------------------------------------------------------------
; Curated personal/offline build: neutralize electron-builder's
; "is the app already running?" check.
;
; electron-builder inserts CHECK_APP_RUNNING during install and uninstall. Its
; default implementation (app-builder-lib/templates/nsis/include/
; allowOnlyOneInstallerInstance.nsh) false-positives for this product name:
;   * per-machine builds use nsProcess::FindProcess, which prefix-matches the
;     installer's OWN process -- "Keep Thy Heart Bible Reader Setup <ver>.exe" begins with
;     "Keep Thy Heart Bible Reader" -- against the app exe "Keep Thy Heart Bible Reader.exe". It then
;     refuses to kill itself (taskkill /fi "PID ne $pid") and loops forever on
;     "Keep Thy Heart Bible Reader cannot be closed. Please close it manually...".
;   * either mode also blocks if Windows' "reopen my apps after restart" had
;     relaunched a prior copy of the app.
;
; allowOnlyOneInstallerInstance.nsh routes CHECK_APP_RUNNING to
; customCheckAppRunning whenever that macro is defined, so defining it empty
; makes the running-app check a no-op. Safe for a single-user local install:
; just close the app yourself before installing.
; ---------------------------------------------------------------------------
!macro customCheckAppRunning
!macroend
