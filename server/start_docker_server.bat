@echo off
chcp 65001 >nul 2>&1
title Docker Backend Server (Port 8790) - KSK Portal Gateway
cd /d "%~dp0"

echo ======================================================================
echo   KHOI CHAY RIENG DOCKER SERVER BACKEND - KSK PORTAL GATEWAY
echo   - Dich vu muc tieu   : ksk-gateway-server (FastAPI Python 3.12)
echo   - Cong ket noi API   : http://127.0.0.1:8790  (Swagger: /docs)
echo   - Database SQLite    : Giu nguyen an toan trong Volume ksk_gateway_data
echo   - Che do             : Giu tien trinh CMD (Bam Ctrl + C de tat Server)
echo ======================================================================

echo.
echo [1/4] Kiem tra Docker Desktop...
docker info >nul 2>&1
if errorlevel 1 (
    echo [LOI] Docker Desktop chua duoc bat hoac chua khoi dong xong!
    echo Vui long mo Docker Desktop doi den khi bao "Engine running" roi chay lai file nay.
    if /i not "%~1"=="--detach" pause
    exit /b 1
)

echo [2/4] Dang tat Container Server cu (ksk-gateway-server) neu dang chay...
docker compose stop ksk-gateway-server >nul 2>&1
docker compose rm -f ksk-gateway-server >nul 2>&1

echo.
echo [3/4] Dang Build moi ma nguon thu muc server\...
docker compose build ksk-gateway-server
if errorlevel 1 (
    echo.
    echo [LOI] Build Docker Server gap loi! Vui long kiem tra ma nguon Python / Dockerfile.
    if /i not "%~1"=="--detach" pause
    exit /b 1
)

echo.
echo [4/4] Dang khoi dong Container Server moi (Port 8790)...
docker compose up -d --no-deps --force-recreate ksk-gateway-server
if errorlevel 1 (
    echo.
    echo [LOI] Khong the khoi dong ksk-gateway-server! Kiem tra xem cong 8790 co bi chiem khong.
    if /i not "%~1"=="--detach" pause
    exit /b 1
)

docker image prune -f >nul 2>&1

if /i "%~1"=="--detach" exit /b 0

echo.
echo ======================================================================
echo   [DANG CHAY] DOCKER SERVER DANG HOAT DONG TAI http://127.0.0.1:8790
echo   - Swagger Docs : http://127.0.0.1:8790/docs
echo   - Cua so CMD nay dang giu Server va hien thi Log truc tiep.
echo   - Bam Ctrl + C tai day de TAT Docker Server!
echo ======================================================================
docker ps --filter "name=^ksk-gateway-server$" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ----------------------------------------------------------------------

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not [Console]::IsInputRedirected) { [Console]::TreatControlCAsInput = $true }; $logProc=Start-Process -FilePath 'docker' -ArgumentList 'logs -f --tail 30 ksk-gateway-server' -NoNewWindow -PassThru; $ctrlC=$false; try { while (-not $logProc.HasExited) { if (-not [Console]::IsInputRedirected -and [Console]::KeyAvailable) { $k=[Console]::ReadKey($true); if (($k.Modifiers -band [ConsoleModifiers]::Control) -and ($k.Key -eq 'C')) { $ctrlC=$true; break } }; Start-Sleep -Milliseconds 200 } } finally { $wasRunning = -not $logProc.HasExited; if ($wasRunning) { Stop-Process -Id $logProc.Id -Force -ErrorAction SilentlyContinue }; if ($ctrlC -or $wasRunning) { Write-Host ''; Write-Host '[CTRL+C] Dang tat Docker Server (ksk-gateway-server)...' -ForegroundColor Yellow; docker compose stop ksk-gateway-server | Out-Null; Write-Host '[DA TAT] Da tat Docker Server thanh cong! (Database van duoc giu an toan)' -ForegroundColor Green } else { Write-Host ''; Write-Host '[DA DUNG] Container Server da dung hoac duoc khoi dong lai tu cua so khac.' -ForegroundColor Yellow } }"
