@echo off
chcp 65001 >nul 2>&1
title BinhAn KSK Portal Gateway Client - Frontend
cd /d "%~dp0"

echo ==================================================================
echo   KHOI DONG CLIENT FRONTEND - HE THONG DAY CONG KSK QUOC GIA
echo   Giao dien Vite/React: http://127.0.0.1:5190
echo   Ket noi Backend: Doc tu file .env (VITE_API_BASE_URL)
echo ==================================================================

call npm.cmd run dev
if errorlevel 1 (
    echo.
    echo [LOI] Client gap loi hoac dung dot ngot!
    pause
)
