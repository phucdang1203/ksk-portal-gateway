param(
    [switch]$DbOnly,
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ModeLabel = if ($DbOnly) { "DB_ONLY" } else { "FULL_PORTABLE" }
$BackupRoot = Join-Path $RootDir "backups"
$OutDir = Join-Path $BackupRoot "KSK_DOCKER_${ModeLabel}_${Timestamp}"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  SAO LUU HE THONG DOCKER - KSK PORTAL GATEWAY ($ModeLabel)" -ForegroundColor Cyan
Write-Host "  Thu muc xuat: $OutDir" -ForegroundColor Gray
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Hot Backup SQLite Database + Uploads from Volume ksk_gateway_data
Write-Host "`n[1/4] Dang sao luu nguyen tu SQLite Database (ksk_gateway.db) va du lieu Volume..." -ForegroundColor Yellow

$PyBackupScript = @'
import os, shutil, sqlite3, tarfile
src_dir = '/app/server/data'
stage_dir = '/tmp/ksk_backup_stage'
tar_out = '/tmp/ksk_data_volume.tar.gz'
if os.path.exists(stage_dir):
    shutil.rmtree(stage_dir)
os.makedirs(stage_dir, exist_ok=True)

db_src = os.path.join(src_dir, 'ksk_gateway.db')
if os.path.exists(db_src):
    s_conn = sqlite3.connect(db_src)
    d_conn = sqlite3.connect(os.path.join(stage_dir, 'ksk_gateway.db'))
    with d_conn:
        s_conn.backup(d_conn)
    d_conn.close()
    s_conn.close()

for sub in ('uploads', 'samples'):
    sp = os.path.join(src_dir, sub)
    if os.path.isdir(sp):
        shutil.copytree(sp, os.path.join(stage_dir, sub))

with tarfile.open(tar_out, 'w:gz') as tf:
    for item in os.listdir(stage_dir):
        tf.add(os.path.join(stage_dir, item), arcname=item)

shutil.rmtree(stage_dir, ignore_errors=True)
print('BACKUP_STAGE_OK')
'@

$RunningId = (docker ps -q -f "name=^ksk-gateway-server$")
$DataArchive = Join-Path $OutDir "ksk_data_volume.tar.gz"

if ($RunningId) {
    docker exec ksk-gateway-server python -c $PyBackupScript | Out-Null
    docker cp "ksk-gateway-server:/tmp/ksk_data_volume.tar.gz" $DataArchive
    docker exec ksk-gateway-server rm -f /tmp/ksk_data_volume.tar.gz | Out-Null
} else {
    $PyOfflineCmd = $PyBackupScript + "`nimport shutil; shutil.move('/tmp/ksk_data_volume.tar.gz', '/backup_out/ksk_data_volume.tar.gz')"
    docker run --rm `
        -v ksk_gateway_data:/app/server/data `
        -v "${OutDir}:/backup_out" `
        ksk-portal-gateway-server:latest `
        python -c $PyOfflineCmd | Out-Null
}

if (-not (Test-Path $DataArchive)) {
    throw "Khong tao duoc file sao luu du lieu ksk_data_volume.tar.gz!"
}
$DataSizeKB = [math]::Round((Get-Item $DataArchive).Length / 1KB, 1)
Write-Host "  -> Da dong goi Database & du lieu: ksk_data_volume.tar.gz ($DataSizeKB KB)" -ForegroundColor Green

# 2. Export Docker Image (when not -DbOnly) so target server needs zero source code and zero internet
if (-not $DbOnly) {
    Write-Host "`n[2/4] Dang xuat Docker Image Server (ksk-portal-gateway-server)..." -ForegroundColor Yellow
    $ImgArchive = Join-Path $OutDir "ksk_docker_images.tar"
    docker save -o $ImgArchive ksk-portal-gateway-server:latest
    $ImgSizeMB = [math]::Round((Get-Item $ImgArchive).Length / 1MB, 1)
    Write-Host "  -> Da xuat Docker Image: ksk_docker_images.tar ($ImgSizeMB MB)" -ForegroundColor Green
} else {
    Write-Host "`n[2/4] Che do nhanh (-DbOnly): Bo qua xuat Docker Images." -ForegroundColor Gray
}

# 3. Copy standalone docker-compose.yml + .env + 1-click restore scripts
Write-Host "`n[3/4] Dang dong goi file cau hinh Docker & cong cu khoi phuc tu dong..." -ForegroundColor Yellow

$PortableCompose = Join-Path $RootDir "docker-compose.portable.yml"
if (Test-Path $PortableCompose) {
    Copy-Item $PortableCompose (Join-Path $OutDir "docker-compose.yml") -Force
} else {
    Copy-Item (Join-Path $RootDir "docker-compose.yml") (Join-Path $OutDir "docker-compose.yml") -Force
}

if (Test-Path (Join-Path $RootDir ".env")) {
    Copy-Item (Join-Path $RootDir ".env") (Join-Path $OutDir ".env") -Force
}

foreach ($scriptName in @("docker-restore.ps1", "docker-restore.bat", "docker-restore.sh")) {
    $sp = Join-Path $RootDir $scriptName
    if (Test-Path $sp) {
        Copy-Item $sp (Join-Path $OutDir $scriptName) -Force
    }
}

# 4. Write plain restore guide inside backup package
Write-Host "`n[4/4] Dang tao file huong dan khoi phuc..." -ForegroundColor Yellow
$NowStr = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$GuideLines = @(
    "========================================================================",
    "GOI SAO LUU & DI CHUYEN DOCKER - KSK PORTAL GATEWAY",
    "Thoi diem sao luu: $NowStr",
    "Loai goi:          $ModeLabel",
    "========================================================================",
    "",
    "THANH PHAN TRONG THU MUC NAY:",
    "1. docker-compose.yml      : File cau hinh Docker doc lap (khong can ma nguon)",
    "2. .env                    : Cau hinh cong Server (8790) va khoa bao mat JWT",
    "3. ksk_data_volume.tar.gz  : Ban sao nguyen tu SQLite Database (ksk_gateway.db) + file import",
    "4. ksk_docker_images.tar   : Docker Image Server dong goi san (co trong ban FULL_PORTABLE)",
    "5. docker-restore.bat/.sh  : Cong cu khoi phuc & tu dong chay he thong 1 cham",
    "",
    "CACH CHUYEN SANG MAY CHU MOI (WINDOWS HOAC LINUX DA CAI DOCKER):",
    "- Buoc 1: Copy nguyen thu muc nay sang may chu moi.",
    "- Buoc 2:",
    "  + Tren Windows (Docker Desktop): Bam dup chay file docker-restore.bat",
    "  + Tren Linux Server:             Chay lenh: sh docker-restore.sh",
    "- He thong se tu dong:",
    "  1) Nap Docker Image Server (neu co ksk_docker_images.tar)",
    "  2) Khoi tao Docker Volume ksk_gateway_data va khoi phuc nguyen trang Database",
    "  3) Bat tu dong Container ksk-gateway-server (:8790)",
    "",
    "Dia chi truy cap sau khi chay:",
    "- May chu API (cho App Desktop Client .exe): http://localhost:8790  (hoac http://<IP_MAY_CHU>:8790)",
    "- Tai lieu API Swagger:                      http://localhost:8790/docs"
)
Set-Content -Path (Join-Path $OutDir "HUONG_DAN_CHUYEN_MAY_CHU.txt") -Value ($GuideLines -join "`r`n") -Encoding UTF8

Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "  HOAN TAT SAO LUU DOCKER THANH CONG!" -ForegroundColor Green
Write-Host "  Goi sao luu nam tai: $OutDir" -ForegroundColor White
Write-Host "==================================================================" -ForegroundColor Green

if (-not $NoPause) {
    Write-Host "`nNhan phim bat ky de dong cua so..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
