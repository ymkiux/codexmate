@echo off
setlocal enableextensions
set "VERBOSE_ECHO=0"
if /i "%VERBOSE%"=="1" (
  set "VERBOSE_ECHO=1"
  @echo on
  set "NPM_CONFIG_LOGLEVEL=notice"
)

set "REGISTRY=https://registry.npmjs.org/"
set "PUBLISH_RC=1"
for %%I in ("%~dp0..") do set "ROOT_DIR=%%~fI"
set "LOCAL_NPMRC=%ROOT_DIR%\.npmrc"

where npm >nul 2>&1
if errorlevel 1 (
  echo npm not found in PATH.
  exit /b 1
)

if "%NPM_TOKEN%"=="" (
  if exist "%LOCAL_NPMRC%" (
    if "%VERBOSE_ECHO%"=="1" @echo off
    for /f "usebackq tokens=2,* delims==" %%A in (`findstr /i /c:"_authToken=" "%LOCAL_NPMRC%"`) do (
      if "%%B"=="" (@set "NPM_TOKEN=%%A") else (@set "NPM_TOKEN=%%A=%%B")
    )
    if "%VERBOSE_ECHO%"=="1" @echo on
  )
)
if "%VERBOSE_ECHO%"=="1" @echo off
if "%NPM_TOKEN%"=="" (
  echo NPM_TOKEN is not set and no token found in %LOCAL_NPMRC%.
  exit /b 1
)
if "%VERBOSE_ECHO%"=="1" @echo on

set "TMP_NPMRC=%TEMP%\npmrc-codexmate-publish-%RANDOM%.tmp"
if "%VERBOSE_ECHO%"=="1" @echo off
> "%TMP_NPMRC%" echo //registry.npmjs.org/:_authToken=%NPM_TOKEN%
if "%VERBOSE_ECHO%"=="1" @echo on
set "NPM_CONFIG_USERCONFIG=%TMP_NPMRC%"
set "NPM_CONFIG_REGISTRY=%REGISTRY%"

call npm whoami --registry %REGISTRY%
if errorlevel 1 goto cleanup

echo [step] npm pack --dry-run
call npm pack --dry-run --registry %REGISTRY%
if errorlevel 1 goto cleanup

echo [step] npm publish
if not "%~1"=="" (
  call npm publish --registry %REGISTRY% --otp %~1
) else if not "%NPM_OTP%"=="" (
  call npm publish --registry %REGISTRY% --otp %NPM_OTP%
) else (
  call npm publish --registry %REGISTRY%
)
set "PUBLISH_RC=%ERRORLEVEL%"

goto cleanup

:cleanup
if exist "%TMP_NPMRC%" del /f /q "%TMP_NPMRC%"
exit /b %PUBLISH_RC%
