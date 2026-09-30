@echo off
chcp 65001 >nul
setlocal

REM ==================== 改这三行 ====================
set "QQ_NUMBER=123456789"
set "NAPCAT_DIR=D:\NapCat"
set "QQ_EXE=D:\qq\QQ.exe"
REM ================================================

REM 先杀掉可能存在的 QQ。否则单实例冲突会让 NapCat 拉起的新实例立刻退出，
REM NapCat 自己也跟着退，表现为"双击了一下什么都没发生"。
taskkill /f /im QQ.exe >nul 2>&1
ping -n 4 127.0.0.1 >nul

set NAPCAT_QUICK_ACCOUNT=%QQ_NUMBER%
set NAPCAT_PATCH_PACKAGE=%NAPCAT_DIR%\qqnt.json
set NAPCAT_LOAD_PATH=%NAPCAT_DIR%\loadNapCat.js
set NAPCAT_INJECT_PATH=%NAPCAT_DIR%\NapCatWinBootHook.dll
set NAPCAT_LAUNCHER_PATH=%NAPCAT_DIR%\NapCatWinBootMain.exe
set NAPCAT_MAIN_PATH=%NAPCAT_DIR%/napcat.mjs

echo (async () =^> {await import("file:///%NAPCAT_MAIN_PATH%")})() > "%NAPCAT_LOAD_PATH%"

if not exist "%QQ_EXE%" (
  echo [错误] 找不到 QQ 主程序：%QQ_EXE%
  echo         请修改本脚本顶部的 QQ_EXE
  pause
  exit /b 1
)

if not exist "%NAPCAT_LAUNCHER_PATH%" (
  echo [错误] 找不到 NapCat：%NAPCAT_DIR%
  echo         请先按 setup/NAPCAT_SETUP.md 解压 NapCat
  pause
  exit /b 1
)

echo 正在启动 NapCat（QQ %QQ_NUMBER%，快速登录模式）...
REM 用 start 起一个独立窗口跑 NapCat，这样本脚本结束后不会带走它
start "NapCat" "%NAPCAT_LAUNCHER_PATH%" "%QQ_EXE%" "%NAPCAT_INJECT_PATH%"
ping -n 5 127.0.0.1 >nul
echo.
echo NapCat 已在新窗口启动。首次使用需要扫码，见 setup/NAPCAT_SETUP.md
echo 那个 NapCat 窗口不要关，NapCat 就活在它里面。
ping -n 6 127.0.0.1 >nul
exit /b 0
