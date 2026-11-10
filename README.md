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
├── docker-compose.yml                        # Triển khai nhanh bằng Docker (Server + Web Client)
├── mo_port_firewall_8790.bat                 # Mở port 8790 trên Windows Firewall cho mạng LAN
├── KE_HOACH_VA_AUDIT_KSK_PORTAL_GATEWAY.md   # Tài liệu Kế hoạch thiết kế & Audit toàn diện
├── server/                                   # SERVER RIÊNG BIỆT (FastAPI - Port 8790)
│   ├── start_server.bat                      # Script khởi chạy Server độc lập (Auto-Reload)
│   ├── .env / .env.example                   # Cấu hình môi trường Server
│   ├── Dockerfile                            # Dockerfile riêng cho Server
│   ├── main.py                               # Entrypoint FastAPI Server
│   ├── data/                                 # Lưu trữ SQLite WAL (ksk_gateway.db), uploads & samples
│   ├── core/                                 # Cấu hình & Bảo mật JWT
│   ├── database/                             # Quản lý CSDL cục bộ
│   ├── validators/                           # Bộ kiểm tra 4 lớp TT32 / TT36 / QĐ2062
│   ├── parsers/                              # Bộ đọc & xuất mẫu CSV / Excel
│   └── services/                             # Dịch vụ chuẩn bị gói ký số & Đẩy cổng BYT
└── client/                                   # CLIENT RIÊNG BIỆT (Electron + React - Port 5190)
    ├── start_client.bat                      # Script khởi chạy Client độc lập
    ├── .env / .env.example                   # Cấu hình kết nối Backend (VITE_API_BASE_URL)
    ├── Dockerfile                            # Dockerfile riêng cho Client Web
    ├── electron/main.js                      # Kết nối USB Token Windows Cert Store & Ký số 1 lần
    ├── src/                                  # Giao diện điều khiển 4 bước
    └── dist-release/                         # Bộ cài đặt Windows (.exe)
```

---

## 3. Hướng Dẫn Chạy Độc Lập Từng Phần (Giống `ksk-sync-system`)

### 3.1. Khởi chạy Server (`server/start_server.bat`)
```powershell
cd D:\bv-binhan\projects\ksk-portal-gateway\server
.\start_server.bat
```
- FastAPI REST Service: `http://127.0.0.1:8790` (Swagger Docs: `http://127.0.0.1:8790/docs`)

### 3.2. Khởi chạy Client (`client/start_client.bat`)
```powershell
cd D:\bv-binhan\projects\ksk-portal-gateway\client
.\start_client.bat
```
- Giao diện Vite/Electron: `http://127.0.0.1:5190`
- Hoặc cài đặt trực tiếp từ file đóng gói: `client/dist-release/BinhAn KSK Portal Gateway Setup 1.0.3.exe`.

### 3.3. Triển khai bằng Docker (`docker-compose`)
```bash
cd D:\bv-binhan\projects\ksk-portal-gateway
docker compose up -d --build
```
