@echo off
chcp 65001 >nul
echo ==============================================================
echo   MO PORT 8790 TREN WINDOWS FIREWALL (KSK PORTAL GATEWAY)
echo ==============================================================
echo.
echo Dang them quy tac cho phep tat ca may tram ket noi port 8790...
netsh advfirewall firewall delete rule name="KSK_Portal_Gateway_FastAPI_8790" >nul 2>&1
netsh advfirewall firewall add rule name="KSK_Portal_Gateway_FastAPI_8790" dir=in action=allow protocol=TCP localport=8790 profile=any description="Cho phep may tram KSK Portal Gateway ket noi FastAPI port 8790"
if %errorlevel% equ 0 (
    echo.
    echo [THANH CONG] Da mo thanh cong cong 8790 tren Windows Firewall cho ca mang Network va LAN!
) else (
    echo.
    echo [CHU Y] Vui long Click chuot phai vao file nay va chon "Run as administrator" (Chay voi quyen quan tri)!
)
echo.
pause
