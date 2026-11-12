@echo off
chcp 65001 >nul 2>&1
title BinhAn KSK Portal Gateway - App Client Desktop
cd /d "%~dp0"

echo ======================================================================
echo   KHOI CHAY APP CLIENT DESKTOP - KSK PORTAL GATEWAY (TEST CODE MOI)
echo   - Ket noi Backend API : http://127.0.0.1:8790 (Docker Server)
echo   - Che do              : Giu tien trinh CMD (Bam Ctrl + C de tat App)
echo ======================================================================

echo.
echo [1/3] Dang kiem tra va dong cua so App Client KSK cu (neu dang mo)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $pidFile=Join-Path $env:APPDATA 'ksk-portal-gateway-client\ksk-client.pid'; if (Test-Path $pidFile) { $oldPid=[int](Get-Content $pidFile -Raw).Trim(); if ($oldPid -gt 0) { $p=Get-Process -Id $oldPid -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -match 'electron|BinhAn') { Write-Host ('  -> Dong phien App cu (PID ' + $oldPid + ')...'); taskkill /PID $oldPid /T /F | Out-Null } }; Remove-Item $pidFile -Force }; $procs=Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -match 'ksk-portal-gateway|vn\.binhan\.kskgateway' }; foreach ($pr in $procs) { taskkill /PID $pr.ProcessId /T /F | Out-Null }"
ping 127.0.0.1 -n 2 >nul

echo.
echo [2/3] Dang Build ma nguon giao dien moi nhat (vite build)...
set VITE_API_BASE_URL=http://127.0.0.1:8790
call npm.cmd run build
if errorlevel 1 (
    echo.
    echo [LOI] Build ma nguon Client gap loi! Vui long kiem tra thong bao loi phia tren.
    if /i not "%~1"=="--detach" pause
    exit /b 1
)

echo.
echo [3/3] Dang mo cua so App Client Desktop len man hinh...
if /i "%~1"=="--detach" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:KSK_LOAD_DIST='1'; $env:NODE_ENV='production'; $elecExe = (Resolve-Path '.\node_modules\electron\dist\electron.exe').Path; Start-Process -FilePath $elecExe -ArgumentList '.' -WorkingDirectory (Get-Location).Path"
    exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:KSK_LOAD_DIST='1'; $env:NODE_ENV='production'; $elecExe=(Resolve-Path '.\node_modules\electron\dist\electron.exe').Path; $p=Start-Process -FilePath $elecExe -ArgumentList '.' -WorkingDirectory (Get-Location).Path -PassThru; Write-Host ''; Write-Host '======================================================================' -ForegroundColor Green; Write-Host ('  [DANG CHAY] APP CLIENT DESKTOP DANG HOAT DONG (PID: ' + $p.Id + ')') -ForegroundColor Green; Write-Host '  - Cua so CMD nay dang giu App Client.' -ForegroundColor White; Write-Host '  - Bam Ctrl + C tai day (hoac dong cua so App) de TAT App Client!' -ForegroundColor Yellow; Write-Host '======================================================================' -ForegroundColor Green; if (-not [Console]::IsInputRedirected) { [Console]::TreatControlCAsInput = $true }; $ctrlC=$false; try { while (-not $p.HasExited) { if (-not [Console]::IsInputRedirected -and [Console]::KeyAvailable) { $k=[Console]::ReadKey($true); if (($k.Modifiers -band [ConsoleModifiers]::Control) -and ($k.Key -eq 'C')) { $ctrlC=$true; break } }; Start-Sleep -Milliseconds 200 } } finally { if ($ctrlC -or -not $p.HasExited) { if (-not $p.HasExited) { Write-Host ''; Write-Host ('[CTRL+C] Dang tat App Client (PID ' + $p.Id + ')...') -ForegroundColor Yellow; taskkill /PID $p.Id /T /F 2>$null | Out-Null }; $pidFile=Join-Path $env:APPDATA 'ksk-portal-gateway-client\ksk-client.pid'; if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }; Write-Host '[DA TAT] Da tat App Client thanh cong!' -ForegroundColor Green } else { Write-Host ''; Write-Host '[DA TAT] Cua so App Client da dong.' -ForegroundColor Yellow } }"
