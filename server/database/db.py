import os
import json
import sqlite3
import datetime
from typing import Dict, Any, List, Optional, Tuple
from server.core.config import DB_PATH
from server.core.security import hash_password

# Hai phòng ban hệ thống được bảo vệ (không cho phép đổi tên, khóa hoặc xóa)
SYSTEM_DEPT_NAMES: Tuple[str, ...] = (
    "Ban Giám đốc",
    "Phòng Quản trị hệ thống",
)

# Danh mục 13 quyền chuẩn đặc thù cho Hệ thống Đẩy Cổng Khám Sức Khỏe Quốc Gia
# Tuple: (perm_code, perm_name, module, group_name, description, sort_order)
SYSTEM_PERMISSIONS: List[Tuple[str, str, str, str, str, int]] = [
    (
        "PERM_KSK_WORKSPACE_VIEW",
        "Truy cập Bàn làm việc KSK",
        "KSK",
        "1. Nghiệp vụ Khám Sức Khỏe",
        "Xem danh sách lô import, thống kê và danh sách hồ sơ KSK trên bàn làm việc",
        10,
    ),
    (
        "PERM_KSK_BATCH_IMPORT",
        "Import lô dữ liệu CSV/Excel",
        "KSK",
        "1. Nghiệp vụ Khám Sức Khỏe",
        "Tải lên file CSV/Excel xuất từ HIS để tạo lô hồ sơ KSK mới",
        20,
    ),
    (
        "PERM_KSK_BATCH_DELETE",
        "Xóa lô dữ liệu import",
        "KSK",
        "1. Nghiệp vụ Khám Sức Khỏe",
        "Xóa lô import khỏi hệ thống",
        30,
    ),
    (
        "PERM_KSK_RECORD_EDIT",
        "Chỉnh sửa & Bổ sung hồ sơ KSK",
        "KSK",
        "1. Nghiệp vụ Khám Sức Khỏe",
        "Sửa chi tiết từng hồ sơ, chạy Tiền kiểm lại và Bổ sung hàng loạt (Bulk Complete)",
        40,
    ),
    (
        "PERM_KSK_SIGN_TOKEN",
        "Ký số bằng USB Token Bệnh viện",
        "KSK",
        "1. Nghiệp vụ Khám Sức Khỏe",
        "Thực hiện Bước 3: Đóng gói XML/JSON và ký số RSA-SHA256 bằng USB Token cắm tại máy trạm",
        50,
    ),
    (
        "PERM_KSK_PUSH_PORTAL",
        "Đẩy hồ sơ lên Cổng Quốc gia",
        "KSK",
        "1. Nghiệp vụ Khám Sức Khỏe",
        "Thực hiện Bước 4: Đẩy các gói đã ký số lên Cổng KCB Quốc gia / BHXH",
        60,
    ),
    (
        "PERM_KSK_HISTORY_VIEW",
        "Xem Nhật ký Ký số & Đẩy cổng",
        "KSK",
        "1. Nghiệp vụ Khám Sức Khỏe",
        "Xem tab Nhật ký các gói ký số, giao dịch đẩy cổng và tra cứu Audit Logs",
        70,
    ),
    (
        "PERM_ORG_DEPT_MANAGE",
        "Quản lý Khoa / Phòng",
        "ORG",
        "2. Tổ chức & Nhân sự",
        "Xem, thêm, sửa, khóa/mở khóa, xóa Khoa/Phòng và gán Trưởng phòng",
        80,
    ),
    (
        "PERM_ORG_POSITION_MANAGE",
        "Quản lý Danh mục Chức vụ",
        "ORG",
        "2. Tổ chức & Nhân sự",
        "Thêm, sửa, khóa/mở khóa và xóa Chức vụ trong Khoa/Phòng hoặc Toàn viện",
        90,
    ),
    (
        "PERM_ORG_USER_MANAGE",
        "Quản lý Tài khoản Người dùng",
        "ORG",
        "2. Tổ chức & Nhân sự",
        "Tạo tài khoản, cập nhật thông tin, CCHN, đặt lại mật khẩu, khóa/xóa người dùng",
        100,
    ),
    (
        "PERM_ORG_PERMISSION_MANAGE",
        "Phân quyền 3 tầng (Khoa/Chức vụ/User)",
        "ORG",
        "2. Tổ chức & Nhân sự",
        "Cấu hình ma trận quyền Tầng A (Khoa/Phòng), Tầng B (Chức vụ) và Tầng C (Cá nhân)",
        110,
    ),
    (
        "PERM_SYS_PORTAL_CONFIG",
        "Cấu hình Đơn vị & Cổng KSK Quốc gia",
        "SYS",
        "3. Quản trị Hệ thống",
        "Cấu hình Mã CSKCB, Tài khoản liên thông Cổng KCB, Chế độ Mock/Production",
        120,
    ),
    (
        "PERM_SYS_CLIENTS_MANAGE",
        "Quản lý & Điều khiển Máy trạm kết nối",
        "SYS",
        "3. Quản trị Hệ thống",
        "Xem danh sách máy trạm theo IP, lịch sử đăng nhập, Chặn/Mở chặn IP, Đăng xuất từ xa",
        130,
    ),
]


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def now_vn_str() -> str:
    tz = datetime.timezone(datetime.timedelta(hours=7))
    return datetime.datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")


def now_utc_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _ensure_column(cur: sqlite3.Cursor, table: str, col_name: str, col_def: str):
    cols = {r["name"] for r in cur.execute(f"PRAGMA table_info({table})").fetchall()}
    if col_name not in cols:
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}")


def sync_system_permissions(cur: sqlite3.Cursor):
    """Đồng bộ danh mục 13 quyền chuẩn vào bảng permissions."""
    for perm_code, perm_name, module, group_name, description, sort_order in SYSTEM_PERMISSIONS:
        cur.execute(
            """
            INSERT INTO permissions (perm_code, perm_name, module, group_name, description, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(perm_code) DO UPDATE SET
                perm_name = excluded.perm_name,
                module = excluded.module,
                group_name = excluded.group_name,
                description = excluded.description,
                sort_order = excluded.sort_order
            """,
            (perm_code, perm_name, module, group_name, description, sort_order),
        )


def init_database():
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS departments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                name_en TEXT DEFAULT '',
                description TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                department_id INTEGER DEFAULT NULL,
                description TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                email TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                role TEXT DEFAULT 'staff',
                cchn TEXT DEFAULT '',
                position_id INTEGER DEFAULT NULL,
                is_active INTEGER DEFAULT 1,
                token_version INTEGER DEFAULT 1,
                last_login TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS user_department (
                user_id INTEGER NOT NULL,
                department_id INTEGER NOT NULL,
                PRIMARY KEY (user_id, department_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                perm_code TEXT UNIQUE NOT NULL,
                perm_name TEXT NOT NULL,
                module TEXT NOT NULL,
                group_name TEXT NOT NULL,
                description TEXT DEFAULT '',
                sort_order INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS department_permissions (
                department_id INTEGER NOT NULL,
                permission_id INTEGER NOT NULL,
                PRIMARY KEY (department_id, permission_id),
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
                FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS position_permissions (
                position_id INTEGER NOT NULL,
                permission_id INTEGER NOT NULL,
                PRIMARY KEY (position_id, permission_id),
                FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE,
                FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_permissions (
                user_id INTEGER NOT NULL,
                permission_id INTEGER NOT NULL,
                is_granted INTEGER DEFAULT 1,
                PRIMARY KEY (user_id, permission_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS client_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_ip TEXT UNIQUE NOT NULL,
                session_uid TEXT DEFAULT '',
                hostname TEXT DEFAULT '',
                os_username TEXT DEFAULT '',
                platform TEXT DEFAULT '',
                os_release TEXT DEFAULT '',
                arch TEXT DEFAULT '',
                mac_address TEXT DEFAULT '',
                cpu_info TEXT DEFAULT '',
                total_ram_gb REAL DEFAULT NULL,
                os_uptime_hours REAL DEFAULT NULL,
                network_interfaces_json TEXT DEFAULT '[]',
                user_agent TEXT DEFAULT '',
                client_version TEXT DEFAULT '',
                user_id INTEGER DEFAULT NULL,
                last_user_id INTEGER DEFAULT NULL,
                last_login_at TEXT DEFAULT NULL,
                last_logout_at TEXT DEFAULT NULL,
                first_connected_at TEXT NOT NULL,
                last_heartbeat_at TEXT NOT NULL,
                is_online INTEGER DEFAULT 1,
                is_blocked INTEGER DEFAULT 0,
                blocked_reason TEXT DEFAULT NULL,
                blocked_at TEXT DEFAULT NULL,
                blocked_by_id INTEGER DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (last_user_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (blocked_by_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS client_ip_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_ip TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                is_active INTEGER DEFAULT 1,
                login_count INTEGER DEFAULT 1,
                first_login_at TEXT NOT NULL,
                last_login_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                last_logout_at TEXT DEFAULT NULL,
                last_client_version TEXT DEFAULT '',
                last_hostname TEXT DEFAULT '',
                last_os_username TEXT DEFAULT '',
                UNIQUE (client_ip, user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS client_login_histories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_ip TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                session_uid TEXT DEFAULT '',
                hostname TEXT DEFAULT '',
                os_username TEXT DEFAULT '',
                platform TEXT DEFAULT '',
                mac_address TEXT DEFAULT '',
                client_version TEXT DEFAULT '',
                login_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                logout_at TEXT DEFAULT NULL,
                status TEXT DEFAULT 'active',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_client_login_hist_ip_user ON client_login_histories(client_ip, user_id);
            CREATE INDEX IF NOT EXISTS idx_client_login_hist_status ON client_login_histories(client_ip, status);

            CREATE TABLE IF NOT EXISTS revoked_sessions (
                session_uid TEXT PRIMARY KEY,
                revoked_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS system_configs (
                config_key TEXT PRIMARY KEY,
                config_value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS import_batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_code TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                exam_type TEXT DEFAULT 'MIXED',
                total_records INTEGER DEFAULT 0,
                eligible_count INTEGER DEFAULT 0,
                invalid_count INTEGER DEFAULT 0,
                signed_count INTEGER DEFAULT 0,
                synced_count INTEGER DEFAULT 0,
                notes TEXT DEFAULT '',
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ksk_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id INTEGER NOT NULL,
                batch_code TEXT NOT NULL,
                row_index INTEGER NOT NULL,
                ma_kcb TEXT NOT NULL,
                ma_benh_nhan TEXT DEFAULT '',
                ho_va_ten TEXT DEFAULT '',
                so_cccd TEXT DEFAULT '',
                ngay_sinh TEXT DEFAULT '',
                gioi_tinh TEXT DEFAULT '',
                ngay_kham TEXT DEFAULT '',
                loai_ksk TEXT DEFAULT 'DINH_KY',
                phan_loai_sk TEXT DEFAULT '',
                bs_ket_luan TEXT DEFAULT '',
                cchn_bs_ket_luan TEXT DEFAULT '',
                has_conclusion_signature INTEGER DEFAULT 0,
                has_specialty_signatures INTEGER DEFAULT 0,
                is_eligible INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                warning_count INTEGER DEFAULT 0,
                record_json TEXT NOT NULL,
                validation_json TEXT NOT NULL,
                signing_status TEXT DEFAULT 'UNSIGNED',
                hospital_signature TEXT DEFAULT '',
                hospital_record_digest TEXT DEFAULT '',
                cert_serial TEXT DEFAULT '',
                cert_subject TEXT DEFAULT '',
                cert_issuer TEXT DEFAULT '',
                cert_thumbprint TEXT DEFAULT '',
                signed_at TEXT,
                signed_by TEXT,
                signed_package_id TEXT,
                sync_status TEXT DEFAULT 'PENDING',
                portal_msg_id TEXT,
                synced_at TEXT,
                synced_by TEXT,
                sync_response TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_ksk_records_batch ON ksk_records(batch_id);
            CREATE INDEX IF NOT EXISTS idx_ksk_records_makcb ON ksk_records(ma_kcb);
            CREATE INDEX IF NOT EXISTS idx_ksk_records_eligible ON ksk_records(is_eligible);
            CREATE INDEX IF NOT EXISTS idx_ksk_records_signing ON ksk_records(signing_status);
            CREATE INDEX IF NOT EXISTS idx_ksk_records_sync ON ksk_records(sync_status);

            CREATE TABLE IF NOT EXISTS signed_packages (
                package_id TEXT PRIMARY KEY,
                batch_id INTEGER,
                record_ids_json TEXT NOT NULL,
                record_count INTEGER NOT NULL,
                header_json TEXT NOT NULL,
                data_base64 TEXT NOT NULL,
                checksum TEXT NOT NULL,
                string_to_sign TEXT NOT NULL,
                hospital_signature TEXT NOT NULL,
                cert_info_json TEXT NOT NULL,
                signed_by TEXT NOT NULL,
                signed_at TEXT NOT NULL,
                push_status TEXT DEFAULT 'READY_TO_PUSH',
                pushed_at TEXT,
                portal_response_json TEXT
            );

            CREATE TABLE IF NOT EXISTS portal_push_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                package_id TEXT NOT NULL,
                batch_id INTEGER,
                target_env TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                record_count INTEGER NOT NULL,
                http_status INTEGER DEFAULT 0,
                is_success INTEGER DEFAULT 0,
                is_simulation INTEGER DEFAULT 0,
                request_summary TEXT,
                response_payload TEXT,
                error_message TEXT,
                execution_time_ms INTEGER DEFAULT 0,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                action TEXT NOT NULL,
                detail TEXT NOT NULL,
                status TEXT DEFAULT 'SUCCESS',
                ip_address TEXT DEFAULT '127.0.0.1',
                created_at TEXT NOT NULL
            );
            """
        )

        # Non-destructive column upgrades cho bảng users hiện hữu
        _ensure_column(cur, "users", "email", "TEXT DEFAULT ''")
        _ensure_column(cur, "users", "phone", "TEXT DEFAULT ''")
        _ensure_column(cur, "users", "position_id", "INTEGER DEFAULT NULL")
        _ensure_column(cur, "users", "token_version", "INTEGER DEFAULT 1")

        # Chuẩn hóa chữ thường cho cột role của dữ liệu cũ
        cur.execute("UPDATE users SET role = 'admin' WHERE UPPER(role) = 'ADMIN'")
        cur.execute("UPDATE users SET role = 'truong_phong' WHERE UPPER(role) = 'TRUONG_PHONG'")
        cur.execute("UPDATE users SET role = 'staff' WHERE role IS NULL OR UPPER(role) IN ('STAFF', 'USER', 'DOCTOR')")

        now = now_vn_str()

        # 1. Đồng bộ danh mục 13 quyền chuẩn
        sync_system_permissions(cur)

        # 2. Khởi tạo các Khoa/Phòng mặc định
        default_depts = [
            ("Ban Giám đốc", "BGĐ", "Ban Giám đốc Bệnh viện Đa khoa Bình An"),
            ("Phòng Quản trị hệ thống", "QTHT", "Phòng Công nghệ thông tin & Quản trị hệ thống"),
            ("Khoa Khám bệnh - KSK", "KKB", "Khoa Khám bệnh & Khám sức khỏe định kỳ / lái xe"),
        ]
        for d_name, d_code, d_desc in default_depts:
            cur.execute(
                """
                INSERT INTO departments (name, name_en, description, is_active, created_at)
                VALUES (?, ?, ?, 1, ?)
                ON CONFLICT(name) DO NOTHING
                """,
                (d_name, d_code, d_desc, now),
            )

        dept_rows = cur.execute("SELECT id, name, name_en FROM departments").fetchall()
        dept_by_name = {r["name"]: r["id"] for r in dept_rows}
        qtht_id = dept_by_name.get("Phòng Quản trị hệ thống")
        kkb_id = dept_by_name.get("Khoa Khám bệnh - KSK")

        # 3. Khởi tạo các Chức vụ mẫu nếu bảng positions đang trống
        pos_cnt = cur.execute("SELECT COUNT(*) AS cnt FROM positions").fetchone()["cnt"]
        if pos_cnt == 0:
            seed_positions = [
                ("QTHT_QUAN_TRI_VIEN", "Quản trị viên hệ thống", qtht_id, "Quản trị toàn bộ hệ thống KSK Portal Gateway"),
                ("KKB_TRUONG_KHOA", "Trưởng khoa Khám bệnh - KSK", kkb_id, "Trưởng khoa phụ trách chuyên môn và duyệt đẩy cổng KSK"),
                ("KKB_BAC_SI_KET_LUAN", "Bác sĩ Kết luận KSK", kkb_id, "Bác sĩ khám và kết luận phân loại sức khỏe"),
                ("KKB_CAN_BO_DAY_CONG", "Cán bộ Chuyên trách Đẩy Cổng", kkb_id, "Cán bộ kiểm tra hồ sơ, ký số USB Token và đẩy Cổng Quốc gia"),
            ]
            for p_code, p_name, p_dept_id, p_desc in seed_positions:
                cur.execute(
                    """
                    INSERT INTO positions (code, name, department_id, description, is_active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 1, ?, ?)
                    ON CONFLICT(code) DO NOTHING
                    """,
                    (p_code, p_name, p_dept_id, p_desc, now, now),
                )

        # 4. Seed default users nếu chưa có user nào
        cur.execute("SELECT COUNT(*) as cnt FROM users")
        if cur.fetchone()["cnt"] == 0:
            cur.execute(
                """
                INSERT INTO users (username, password_hash, full_name, email, phone, role, cchn, is_active, token_version, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
                """,
                (
                    "admin",
                    hash_password("admin123"),
                    "Quản trị viên Cổng KSK Quốc Gia",
                    "cntt@bvbinhan.vn",
                    "02973949949",
                    "admin",
                    "001245/KG-CCHN",
                    now,
                ),
            )
            cur.execute(
                """
                INSERT INTO users (username, password_hash, full_name, email, phone, role, cchn, is_active, token_version, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
                """,
                (
                    "91034",
                    hash_password("123456"),
                    "Cán bộ Đẩy Cổng KSK (BV Bình An)",
                    "ksk@bvbinhan.vn",
                    "02973949950",
                    "staff",
                    "005678/KG-CCHN",
                    now,
                ),
            )

        # 5. Seed mặc định ma trận phân quyền mẫu 3 tầng lần đầu tiên (chỉ chạy 1 lần)
        cur.execute("SELECT config_key FROM system_configs WHERE config_key = 'rbac_seeded_v1'")
        if not cur.fetchone():
            perm_rows = cur.execute("SELECT id, perm_code FROM permissions").fetchall()
            perm_id_map = {r["perm_code"]: r["id"] for r in perm_rows}

            # Tầng A cho Phòng Quản trị hệ thống
            if qtht_id:
                for p_code in (
                    "PERM_ORG_DEPT_MANAGE",
                    "PERM_ORG_POSITION_MANAGE",
                    "PERM_ORG_USER_MANAGE",
                    "PERM_ORG_PERMISSION_MANAGE",
                    "PERM_SYS_PORTAL_CONFIG",
                    "PERM_SYS_CLIENTS_MANAGE",
                ):
                    if p_code in perm_id_map:
                        cur.execute(
                            "INSERT OR IGNORE INTO department_permissions (department_id, permission_id) VALUES (?, ?)",
                            (qtht_id, perm_id_map[p_code]),
                        )

            # Tầng A cho Khoa Khám bệnh - KSK (quyền cơ bản của khoa)
            if kkb_id:
                for p_code in (
                    "PERM_KSK_WORKSPACE_VIEW",
                    "PERM_KSK_BATCH_IMPORT",
                    "PERM_KSK_RECORD_EDIT",
                    "PERM_KSK_HISTORY_VIEW",
                ):
                    if p_code in perm_id_map:
                        cur.execute(
                            "INSERT OR IGNORE INTO department_permissions (department_id, permission_id) VALUES (?, ?)",
                            (kkb_id, perm_id_map[p_code]),
                        )

            # Tầng B cho Trưởng khoa & Cán bộ Chuyên trách Đẩy Cổng (thừa kế A + thêm quyền Ký số & Đẩy cổng)
            pos_rows = cur.execute("SELECT id, code FROM positions").fetchall()
            pos_id_by_code = {r["code"]: r["id"] for r in pos_rows}
            for pos_code in ("KKB_TRUONG_KHOA", "KKB_CAN_BO_DAY_CONG"):
                pid = pos_id_by_code.get(pos_code)
                if pid:
                    for p_code in ("PERM_KSK_SIGN_TOKEN", "PERM_KSK_PUSH_PORTAL", "PERM_KSK_BATCH_DELETE"):
                        if p_code in perm_id_map:
                            cur.execute(
                                "INSERT OR IGNORE INTO position_permissions (position_id, permission_id) VALUES (?, ?)",
                                (pid, perm_id_map[p_code]),
                            )

            # Gắn tài khoản mặc định admin và 91034 vào Khoa/Phòng & Chức vụ tương ứng nếu chưa gắn
            admin_row = cur.execute("SELECT id, position_id FROM users WHERE username = 'admin'").fetchone()
            if admin_row and qtht_id:
                cur.execute(
                    "INSERT OR IGNORE INTO user_department (user_id, department_id) VALUES (?, ?)",
                    (admin_row["id"], qtht_id),
                )
                if not admin_row["position_id"] and pos_id_by_code.get("QTHT_QUAN_TRI_VIEN"):
                    cur.execute(
                        "UPDATE users SET position_id = ? WHERE id = ?",
                        (pos_id_by_code["QTHT_QUAN_TRI_VIEN"], admin_row["id"]),
                    )

            staff_row = cur.execute("SELECT id, position_id FROM users WHERE username = '91034'").fetchone()
            if staff_row and kkb_id:
                cur.execute(
                    "INSERT OR IGNORE INTO user_department (user_id, department_id) VALUES (?, ?)",
                    (staff_row["id"], kkb_id),
                )
                if not staff_row["position_id"] and pos_id_by_code.get("KKB_CAN_BO_DAY_CONG"):
                    cur.execute(
                        "UPDATE users SET position_id = ? WHERE id = ?",
                        (pos_id_by_code["KKB_CAN_BO_DAY_CONG"], staff_row["id"]),
                    )

            cur.execute(
                "INSERT INTO system_configs (config_key, config_value, updated_at) VALUES ('rbac_seeded_v1', 'true', ?)",
                (now,),
            )

        # 6. Seed default configs
        default_configs = {
            "hospital": {
                "ma_cskcb": os.getenv("DEFAULT_MA_CSKCB", "91034"),
                "ten_benh_vien": os.getenv("DEFAULT_TEN_BENH_VIEN", "Bệnh viện Đa khoa Bình An"),
                "ma_so_thue": os.getenv("DEFAULT_MA_SO_THUE", "1700335853"),
                "dia_chi": "80 - 82 Nguyễn Trung Trực, TP. Rạch Giá, Kiên Giang",
            },
            "portal": {
                "env": os.getenv("PORTAL_ENV", "sandbox"),
                "sandbox_url": os.getenv("PORTAL_SANDBOX_URL", "https://api-sandbox.emrhub.vn"),
                "prod_url": os.getenv("PORTAL_PROD_URL", "https://api.emrhub.vn"),
                "egw_url": "https://gdbhyt.baohiemxahoi.gov.vn",
                "username": os.getenv("DEFAULT_MA_CSKCB", "91034"),
                "password": "",
                "simulation_mode": os.getenv("PORTAL_SIMULATION_MODE", "true").lower() == "true",
            },
        }
        for k, v in default_configs.items():
            cur.execute("SELECT config_key FROM system_configs WHERE config_key = ?", (k,))
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO system_configs (config_key, config_value, updated_at) VALUES (?, ?, ?)",
                    (k, json.dumps(v, ensure_ascii=False), now),
                )

        conn.commit()
    finally:
        cur.close()
        conn.close()


def get_all_configs() -> Dict[str, Any]:
    conn = get_conn()
    try:
        rows = conn.execute("SELECT config_key, config_value FROM system_configs").fetchall()
        res = {}
        for r in rows:
            try:
                res[r["config_key"]] = json.loads(r["config_value"])
            except Exception:
                res[r["config_key"]] = r["config_value"]
        return res
    finally:
        conn.close()


def save_config_section(section: str, data: dict):
    conn = get_conn()
    try:
        existing = get_all_configs().get(section, {})
        merged = {**existing, **data}
        conn.execute(
            """
            INSERT INTO system_configs (config_key, config_value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(config_key) DO UPDATE SET
                config_value = excluded.config_value,
                updated_at = excluded.updated_at
            """,
            (section, json.dumps(merged, ensure_ascii=False), now_vn_str()),
        )
        conn.commit()
        return merged
    finally:
        conn.close()


def get_user(username: str, active_only: bool = True) -> Optional[dict]:
    conn = get_conn()
    try:
        if active_only:
            r = conn.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (username,)).fetchone()
        else:
            r = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return dict(r) if r else None
    finally:
        conn.close()


def update_user_last_login(username: str):
    conn = get_conn()
    try:
        conn.execute("UPDATE users SET last_login = ? WHERE username = ?", (now_vn_str(), username))
        conn.commit()
    finally:
        conn.close()


def add_audit_log(username: str, action: str, detail: str, status: str = "SUCCESS", ip_address: str = "127.0.0.1"):
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO audit_logs (username, action, detail, status, ip_address, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (username, action, detail, status, ip_address, now_vn_str()),
        )
        conn.commit()
    finally:
        conn.close()


def refresh_batch_counters(batch_id: int):
    conn = get_conn()
    try:
        stats = conn.execute(
            """
            SELECT
                COUNT(*) AS total_records,
                SUM(CASE WHEN is_eligible = 1 THEN 1 ELSE 0 END) AS eligible_count,
                SUM(CASE WHEN is_eligible = 0 THEN 1 ELSE 0 END) AS invalid_count,
                SUM(CASE WHEN signing_status = 'SIGNED' THEN 1 ELSE 0 END) AS signed_count,
                SUM(CASE WHEN sync_status = 'SYNCED' THEN 1 ELSE 0 END) AS synced_count
            FROM ksk_records
            WHERE batch_id = ?
            """,
            (batch_id,),
        ).fetchone()
        if stats:
            conn.execute(
                """
                UPDATE import_batches
                SET total_records = ?,
                    eligible_count = ?,
                    invalid_count = ?,
                    signed_count = ?,
                    synced_count = ?
                WHERE id = ?
                """,
                (
                    stats["total_records"] or 0,
                    stats["eligible_count"] or 0,
                    stats["invalid_count"] or 0,
                    stats["signed_count"] or 0,
                    stats["synced_count"] or 0,
                    batch_id,
                ),
            )
            conn.commit()
    finally:
        conn.close()
