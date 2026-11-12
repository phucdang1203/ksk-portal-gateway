#!/bin/sh
set -e

WORK_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$WORK_DIR"

echo "=================================================================="
echo "  KHOI PHUC & KHOI CHAY DOCKER - KSK PORTAL GATEWAY (LINUX/MAC)"
echo "  Thu muc: $WORK_DIR"
echo "=================================================================="

if [ ! -f "ksk_data_volume.tar.gz" ]; then
  echo "[LOI] Khong tim thay file ksk_data_volume.tar.gz trong $WORK_DIR"
  exit 1
fi

if [ -f "ksk_docker_images.tar" ]; then
  echo "[1/4] Dang nap Docker Images tu ksk_docker_images.tar..."
  docker load -i ksk_docker_images.tar
else
  echo "[1/4] Su dung Docker Images co san..."
fi

echo "[2/4] Chuan bi Docker Volume ksk_gateway_data..."
docker compose down >/dev/null 2>&1 || true
docker volume create --label com.docker.compose.project=ksk-portal-gateway --label com.docker.compose.volume=ksk_gateway_data ksk_gateway_data >/dev/null
docker volume create --label com.docker.compose.project=ksk-portal-gateway --label com.docker.compose.volume=ksk_gateway_releases ksk_gateway_releases >/dev/null

echo "[3/4] Dang khoi phuc Database (ksk_gateway.db) vao Volume..."
docker run --rm \
  -v ksk_gateway_data:/app/server/data \
  -v "$WORK_DIR:/backup_in:ro" \
  ksk-portal-gateway-server:latest \
  python -c "import os, tarfile; dst='/app/server/data'; os.makedirs(dst, exist_ok=True); [os.remove(os.path.join(dst,f)) for f in ('ksk_gateway.db','ksk_gateway.db-wal','ksk_gateway.db-shm') if os.path.exists(os.path.join(dst,f))]; tf=tarfile.open('/backup_in/ksk_data_volume.tar.gz','r:gz'); tf.extractall(dst); tf.close(); print('RESTORE_VOLUME_OK')"

echo "[4/4] Dang khoi dong Docker Compose..."
docker compose up -d

echo "=================================================================="
echo "  HOAN TAT! Docker Server dang chay tai:"
echo "  - May chu REST API: http://localhost:8790/api/health"
echo "  - Swagger Docs:     http://localhost:8790/docs"
echo "=================================================================="
