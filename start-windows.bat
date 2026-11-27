@echo off
setlocal
cd /d "%~dp0"

REM Node.js가 설치되어 있지만 PATH에 등록되지 않은 PC를 위한 경로 보완
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
  if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js/npm을 찾을 수 없습니다.
  echo Node.js Command Prompt에서 이 파일을 실행하거나 Node.js 설치 경로를 PATH에 등록하세요.
  pause
  exit /b 1
)

if not exist .env (
  echo [안내] .env.example을 복사해 .env를 만든 뒤 API 키를 입력하세요.
  copy .env.example .env >nul
  notepad .env
)
if not exist node_modules (
  echo [안내] 필요한 패키지를 설치합니다.
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run dev
pause
