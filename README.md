# Bình An KSK Portal Gateway (`ksk-portal-gateway`)

Hệ thống **Độc lập (Standalone)** chuyên trách **Đẩy Dữ Liệu Khám Sức Khỏe Quốc Gia** theo chuẩn **Thông tư 32/2023/TT-BYT**, **Thông tư 36/2024/TT-BYT** và **Quyết định 2062/QĐ-BYT** (Phụ lục 02).

Dự án được thiết kế tách biệt hoàn toàn giữa **Server (`server/`)** và **Client (`client/`)** theo đúng kiến trúc của `ksk-sync-system`, đồng thời tích hợp sẵn **Docker (`docker-compose.yml`)** để dễ dàng cài đặt ở nơi khác.

---

## 1. Quy Trình Nghiệp Vụ Chuẩn 4 Bước (State Machine)

1. **Bước 1 — Import File (`.csv`, `.xlsx`, `.xls`)**:
   - Chỉ hỗ trợ 2 định dạng **CSV** (`.csv`) và **Excel** (`.xlsx`, `.xls`).
2. **Bước 2 — Kiểm Tra Đầy Đủ Trường & Chữ Ký Bác Sĩ (`Pre-check`)**:
   - Kiểm tra 4 lớp: **Hành chính & CCCD 12 số**, **Sinh hiệu & Thể lực**, **Khám lâm sàng + Chữ ký BS chuyên khoa**, **Chữ ký BS Kết luận & CCHN** (`bs_ket_luan`, `cchn_bs_ket_luan`, `chuky_ket_luan`).
3. **Bước 3 — Ký Số Điện Tử Bệnh Viện 1 Lần (`1-Click Batch Signing` qua USB Token tại máy Client)**:
   - USB Token chữ ký số tổ chức của Bệnh viện cắm trực tiếp vào máy chạy **App Client**.
   - Kiểm tra trước hồ sơ nào còn thiếu thông tin:
     - **Chế độ `STRICT_ALL`**: Chỉ khi **100% hồ sơ đầy đủ thông tin** mới cho phép ký số toàn bộ.
     - **Chế độ `ELIGIBLE_ONLY`**: Cho phép ký số Bệnh viện ngay đối với **những hồ sơ đã đầy đủ thông tin**, bỏ qua các hồ sơ đang thiếu để xử lý sau.
   - **Ký số 1 lần duy nhất** cho toàn bộ hồ sơ hợp lệ đã chọn. Ký xong chuyển sang trạng thái `SIGNED` (**chưa tự động đẩy**).
4. **Bước 4 — Bấm Đẩy Dữ Liệu Lên Cổng Quốc Gia (`Push Portal`)**:
   - Chỉ khi ký số xong (`SIGNED`) và người dùng bấm nút **"Đẩy Lên Cổng"**, hệ thống mới thực sự đẩy dữ liệu lên Cổng Quốc gia.

---

## 2. Cấu Trúc Thư Mục (Đồng Bộ Kiến Trúc `ksk-sync-system`)

```text
D:\bv-binhan\projects\ksk-portal-gateway\
├── KE_HOACH_VA_AUDIT_KSK_PORTAL_GATEWAY.md   # Tài liệu Kế hoạch thiết kế & Audit toàn diện
├── samples/                                  # Thư mục file CSV / Excel mẫu
├── server/                                   # TOÀN BỘ BACKEND SERVER & DOCKER (Port 8790)
│   ├── start_docker_server.bat               # File chạy riêng Docker Server (Tắt cũ -> Build mới -> Chạy lại)
│   ├── docker-compose.yml                    # Cấu hình Docker cho Backend Server + Database Volume
│   ├── docker-backup.bat / docker-restore.bat# Sao lưu trọn gói & Khôi phục di chuyển máy chủ
│   ├── mo_port_firewall_8790.bat             # Mở port 8790 trên Windows Firewall cho mạng LAN
│   ├── .env / .env.example                   # Cấu hình môi trường Server
│   ├── Dockerfile                            # Dockerfile cho Backend Server
│   ├── main.py                               # Entrypoint FastAPI Server
│   ├── core/                                 # Cấu hình, Phân quyền 3 tầng & Bảo mật JWT
│   ├── database/                             # Quản lý CSDL SQLite WAL (Volume ksk_gateway_data)
│   ├── routers/                              # API Quản trị Khoa phòng, Chức vụ, User, Máy trạm
│   ├── validators/                           # Bộ kiểm tra 4 lớp TT32 / TT36 / QĐ2062
│   ├── parsers/                              # Bộ đọc & xuất mẫu CSV / Excel
│   └── services/                             # Dịch vụ chuẩn bị gói ký số & Đẩy cổng BYT
└── client/                                   # TOÀN BỘ APP CLIENT DESKTOP (Electron + React)
    ├── start_client.bat                      # File chạy riêng App Client (Đóng cửa sổ cũ -> Build mới -> Mở App)
    ├── .env / .env.example                   # Cấu hình kết nối Backend (VITE_API_BASE_URL)
    ├── electron/main.js                      # Kết nối USB Token Windows Cert Store & Ký số 1 lần
    ├── src/                                  # Giao diện điều khiển 4 bước & Quản trị hệ thống
    └── dist-release/                         # Bộ cài đặt Windows (.exe)
```

---

## 3. Hướng Dẫn Chạy Riêng Lẻ Từng Phần & Sao Lưu Docker

### 3.1. Chạy riêng Backend Server trên Docker (`server/start_docker_server.bat`)
```powershell
cd D:\bv-binhan\projects\ksk-portal-gateway\server
.\start_docker_server.bat
```
- Tự động tắt container `ksk-gateway-server` cũ -> Build lại mã nguồn `server\` mới nhất -> Khởi động lại Docker Server ở cổng `8790` (giữ nguyên toàn bộ Database trong Volume `ksk_gateway_data`).
- FastAPI REST Service: `http://127.0.0.1:8790` (Swagger Docs: `http://127.0.0.1:8790/docs`)

### 3.2. Chạy riêng App Client Desktop để test code mới (`client/start_client.bat`)
```powershell
cd D:\bv-binhan\projects\ksk-portal-gateway\client
.\start_client.bat
```
- Tự động đóng cửa sổ App Client KSK cũ đang mở -> Build code giao diện mới (`vite build`) -> Bật trực tiếp cửa sổ App Desktop Electron lên màn hình kết nối vào `http://127.0.0.1:8790`.
- Khi cần xuất bộ cài đặt `.exe` cho máy trạm: chạy `npm run pack` trong thư mục `client\` (file `.exe` xuất ra `client/dist-release/` và tự động gắn vào Docker Server).

### 3.3. Sao lưu trọn gói & Di chuyển Docker Server sang máy chủ khác (`server/docker-backup.bat`)
1. **Tại máy hiện tại**, vào thư mục `server\` và bấm đúp chạy `docker-backup.bat` (hoặc `.\docker-backup.bat -DbOnly` nếu chỉ sao lưu nhanh Database).
2. Copy thư mục gói vừa xuất trong `server\backups\KSK_DOCKER_FULL_PORTABLE_...` sang máy chủ mới (Windows hoặc Linux đã cài Docker).
3. **Tại máy chủ mới**, bấm đúp chạy `docker-restore.bat` (Windows) hoặc `sh docker-restore.sh` (Linux) — hệ thống sẽ tự nạp Docker Image, khôi phục nguyên vẹn Database vào Volume `ksk_gateway_data` và tự động chạy bình thường trên cổng `8790`.
