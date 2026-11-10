import os
import json
import sqlite3
import datetime
from typing import Dict, Any, List, Optional
from server.core.config import DB_PATH
from server.core.security import hash_password


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def now_vn_str() -> str:
    tz = datetime.timezone(datetime.timedelta(hours=7))
    return datetime.datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S")


def init_database():
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT DEFAULT 'ADMIN',
                cchn TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                last_login TEXT,
                created_at TEXT NOT NULL
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

        now = now_vn_str()
        # Seed default users
        cur.execute("SELECT COUNT(*) as cnt FROM users")
        if cur.fetchone()["cnt"] == 0:
            cur.execute(
                """
                INSERT INTO users (username, password_hash, full_name, role, cchn, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                ("admin", hash_password("admin123"), "Quản trị viên Cổng KSK Quốc Gia", "ADMIN", "001245/KG-CCHN", now),
            )
            cur.execute(
                """
                INSERT INTO users (username, password_hash, full_name, role, cchn, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                ("91034", hash_password("123456"), "Cán bộ Đẩy Cổng KSK (BV Bình An)", "STAFF", "005678/KG-CCHN", now),
            )

        # Seed default configs
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


def get_user(username: str) -> Optional[dict]:
    conn = get_conn()
    try:
        r = conn.execute("SELECT * FROM users WHERE username = ? AND is_active = 1", (username,)).fetchone()
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
