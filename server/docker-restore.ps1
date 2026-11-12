param(
    [string]$BackupDir = "",
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkDir = if ($BackupDir -and (Test-Path $BackupDir)) { (Resolve-Path $BackupDir).Path } else { $ScriptDir }
Set-Location $WorkDir

$DataArchive = Join-Path $WorkDir "ksk_data_volume.tar.gz"
$ImgArchive = Join-Path $WorkDir "ksk_docker_images.tar"
$ComposeFile = Join-Path $WorkDir "docker-compose.yml"

if (-not (Test-Path $ComposeFile)) {
    throw "Khong tim thay docker-compose.yml trong thu muc: $WorkDir"
}
if (-not (Test-Path $DataArchive)) {
    throw "Khong tim thay file sao luu Database ksk_data_volume.tar.gz trong thu muc: $WorkDir"
}

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  KHOI PHUC & KHOI CHAY DOCKER - KSK PORTAL GATEWAY" -ForegroundColor Cyan
Write-Host "  Nguon khoi phuc: $WorkDir" -ForegroundColor Gray
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Load Docker Images if bundled
if (Test-Path $ImgArchive) {
    Write-Host "`n[1/4] Dang nap Docker Images tu ksk_docker_images.tar..." -ForegroundColor Yellow
    docker load -i $ImgArchive
} else {
    Write-Host "`n[1/4] Khong co ksk_docker_images.tar - su dung Docker Images co san hoac tu build..." -ForegroundColor Gray
    $HasServerImg = (docker images -q ksk-portal-gateway-server:latest)
    if (-not $HasServerImg -and (Test-Path (Join-Path $WorkDir "Dockerfile"))) {
        docker compose build
    }
}

# 2. Stop running containers cleanly & ensure Named Volumes exist
Write-Host "`n[2/4] Chuan bi Docker Volume ksk_gateway_data..." -ForegroundColor Yellow
docker compose down 2>$null | Out-Null
docker volume create --label com.docker.compose.project=ksk-portal-gateway --label com.docker.compose.volume=ksk_gateway_data ksk_gateway_data | Out-Null
docker volume create --label com.docker.compose.project=ksk-portal-gateway --label com.docker.compose.volume=ksk_gateway_releases ksk_gateway_releases | Out-Null

# 3. Restore Database & Uploads into Volume ksk_gateway_data (100% Offline)
Write-Host "`n[3/4] Dang khoi phuc Database (ksk_gateway.db) & du lieu vao Volume..." -ForegroundColor Yellow
$PyRestoreScript = @'
import os, tarfile
dst = '/app/server/data'
os.makedirs(dst, exist_ok=True)
for stale in ('ksk_gateway.db', 'ksk_gateway.db-wal', 'ksk_gateway.db-shm'):
    p = os.path.join(dst, stale)
    if os.path.exists(p):
        os.remove(p)
with tarfile.open('/backup_in/ksk_data_volume.tar.gz', 'r:gz') as tf:
    tf.extractall(dst)
os.makedirs(os.path.join(dst, 'uploads'), exist_ok=True)
os.makedirs(os.path.join(dst, 'samples'), exist_ok=True)
print('RESTORE_VOLUME_OK')
'@

docker run --rm `
    -v ksk_gateway_data:/app/server/data `
    -v "${WorkDir}:/backup_in:ro" `
    ksk-portal-gateway-server:latest `
    python -c $PyRestoreScript

# 4. Start Docker Compose stack
Write-Host "`n[4/4] Dang khoi dong he thong Docker Compose..." -ForegroundColor Yellow
docker compose up -d

Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "  KHOI PHUC VA KHOI CHAY DOCKER SERVER THANH CONG!" -ForegroundColor Green
Write-Host "  - May chu REST API: http://localhost:8790/api/health" -ForegroundColor White
Write-Host "  - Swagger Docs:     http://localhost:8790/docs" -ForegroundColor White
Write-Host "==================================================================" -ForegroundColor Green

if (-not $NoPause) {
    Write-Host "`nNhan phim bat ky de dong cua so..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
