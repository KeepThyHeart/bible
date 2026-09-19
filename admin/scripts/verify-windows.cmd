@echo off
rem admin\scripts\verify-windows.cmd -- verify a commit on Windows.
rem
rem Starts verify-windows.ps1 with -ExecutionPolicy Bypass, so it runs from cmd
rem or a double-click without changing the machine's execution policy. Every
rem argument is passed through; --help lists them.
rem
rem   admin\scripts\verify-windows.cmd            verify this checkout, in place
rem   admin\scripts\verify-windows.cmd --fresh    verify a fresh clone of this checkout's HEAD

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-windows.ps1" %*
exit /b %ERRORLEVEL%
