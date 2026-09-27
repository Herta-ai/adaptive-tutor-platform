@echo off
setlocal
title Adaptive Tutor - Local Learning Studio
"%~dp0runtime\node.exe" "%~dp0launch.mjs"
if errorlevel 1 (
  echo.
  echo Application stopped with an error. Review the message above.
  pause
)
endlocal
