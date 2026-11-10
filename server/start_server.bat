@echo off
chcp 65001 >nul 2>&1
title BinhAn KSK Portal Gateway Server - Backend FastAPI
cd /d "%~dp0"

:loop
cls
echo ==================================================================
echo   KHOI DONG SERVER BACKEND - HE THONG DAY CONG KSK QUOC GIA
echo   FastAPI REST Service: http://127.0.0.1:8790
echo   Docs Swagger UI:      http://127.0.0.1:8790/docs
echo   Local DB:             SQLite WAL (server/data/ksk_gateway.db)
echo   Che do Auto-Reload:   BAT (Tu dong nap ma nguon khi co cap nhat)
echo ==================================================================
echo   Quy trinh 4 buoc doc lap:
echo   1. Import du lieu CSV / Excel (.csv, .xlsx, .xls)
echo   2. Pre-check day du truong bat buoc ^& Chu ky BS Ket luan
echo   3. Ky so dien tu Benh Vien 1 lan (USB Token cam tai may Client)
echo   4. Bam Day du lieu da ky so len Cong KSK Quoc Gia
echo ==================================================================

python main.py
echo.
echo [THONG BAO] Server da dung luc %time%.
echo Nhan phim bat ky de KHOI DONG LAI Server, hoac dong cua so de thoat.
pause >nul
goto loop
