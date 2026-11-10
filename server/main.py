import os
import sys
import json
import glob
import re
import sqlite3
import hashlib
import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
from contextlib import asynccontextmanager

SERVER_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVER_DIR.parent
for _p in (str(SERVER_DIR), str(ROOT_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

if os.name == "nt":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        h_stdin = kernel32.GetStdHandle(-10)  # STD_INPUT_HANDLE
        mode = ctypes.c_uint32()
        if kernel32.GetConsoleMode(h_stdin, ctypes.byref(mode)):
            # Tắt ENABLE_QUICK_EDIT_MODE (0x0040) và bật ENABLE_EXTENDED_FLAGS (0x0080)
            # để tránh việc click chuột vào cửa sổ CMD làm treo tiến trình Server
            new_mode = (mode.value & ~0x0040) | 0x0080
            kernel32.SetConsoleMode(h_stdin, new_mode)
    except Exception:
        pass

from fastapi import FastAPI, HTTPException, Depends, Header, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from server.database.db import (
    init_database,
    get_conn,
    get_all_configs,
    save_config_section,
    get_user,
    update_user_last_login,
    add_audit_log,
    refresh_batch_counters,
    now_vn_str,
)
from server.core.security import verify_password, create_access_token, decode_access_token
from server.validators.ksk_validator import validate_ksk_record
from server.parsers.file_importer import (
    parse_uploaded_file,
    build_sample_excel_bytes,
    build_sample_csv_bytes,
    ensure_sample_files_on_disk,
    SAMPLE_ROWS_DATA,
    normalize_row_dict,
)
from server.services.signer_service import (
    prepare_batch_signing_payload,
    sign_string_with_soft_token,
)
from server.services.portal_client import portal_client


def _seed_initial_demo_batch_if_empty():
    conn = get_conn()
    try:
        cnt = conn.execute("SELECT COUNT(*) as cnt FROM import_batches").fetchone()["cnt"]
        if cnt > 0:
            return
        now = now_vn_str()
        batch_code = "BATCH_MAU_KHOI_TAO"
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO import_batches (
                batch_code, filename, file_type, exam_type,
                total_records, eligible_count, invalid_count, signed_count, synced_count,
                notes, created_by, created_at
            )
            VALUES (?, ?, 'EXCEL', 'MIXED', 0, 0, 0, 0, 0, ?, 'admin', ?)
            """,
            (
                batch_code,
                "mau_import_ksk_quoc_gia.xlsx",
                "Lô dữ liệu mẫu khởi tạo sẵn (4 hồ sơ đủ điều kiện, 1 hồ sơ thiếu CCCD & chữ ký kết luận để kiểm thử)",
                now,
            ),
        )
        batch_id = cur.lastrowid

        for idx, raw_row in enumerate(SAMPLE_ROWS_DATA, start=1):
            norm = normalize_row_dict(raw_row, idx)
            val = validate_ksk_record(norm)
            cur.execute(
                """
                INSERT INTO ksk_records (
                    batch_id, batch_code, row_index, ma_kcb, ma_benh_nhan,
                    ho_va_ten, so_cccd, ngay_sinh, gioi_tinh, ngay_kham,
                    loai_ksk, phan_loai_sk, bs_ket_luan, cchn_bs_ket_luan,
                    has_conclusion_signature, has_specialty_signatures,
                    is_eligible, error_count, warning_count,
                    record_json, validation_json,
                    signing_status, sync_status, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNSIGNED', 'PENDING', ?)
                """,
                (
                    batch_id,
                    batch_code,
                    idx,
                    norm.get("ma_kcb", ""),
                    norm.get("ma_benh_nhan", ""),
                    norm.get("ho_va_ten", ""),
                    norm.get("so_cccd", ""),
                    norm.get("ngay_sinh", ""),
                    norm.get("gioi_tinh", ""),
                    norm.get("ngay_kham", ""),
                    norm.get("loai_ksk", "DINH_KY"),
                    norm.get("phan_loai_sk", ""),
                    norm.get("bs_ket_luan", ""),
                    norm.get("cchn_bs_ket_luan", ""),
                    1 if val["has_conclusion_signature"] else 0,
                    1 if val["has_specialty_signatures"] else 0,
                    1 if val["is_eligible"] else 0,
                    val["error_count"],
                    val["warning_count"],
                    json.dumps(norm, ensure_ascii=False),
                    json.dumps(val, ensure_ascii=False),
                    now,
                ),
            )
        conn.commit()
        refresh_batch_counters(batch_id)
    except Exception as e:
        print(f"[WARN] Không thể tạo lô dữ liệu mẫu ban đầu: {e}")
    finally:
        conn.close()


init_database()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_database()
    ensure_sample_files_on_disk()
    _seed_initial_demo_batch_if_empty()
    yield


app = FastAPI(
    title="KSK Portal Gateway - Hệ Thống Đẩy Cổng Khám Sức Khỏe Quốc Gia",
    description="Ứng dụng độc lập chuyên nhận dữ liệu CSV/Excel, kiểm tra trường & chữ ký kết luận, ký số điện tử Bệnh viện (USB Token Client) và đẩy lên Cổng Quốc gia",
    version="1.0.3",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== PYDANTIC MODELS ====================
class LoginRequest(BaseModel):
    username: str
    password: str


class ConfigSaveRequest(BaseModel):
    hospital: Optional[Dict[str, Any]] = None
    portal: Optional[Dict[str, Any]] = None


class RecordUpdateRequest(BaseModel):
    fields: Dict[str, Any]


class BulkCompleteRequest(BaseModel):
    record_ids: Optional[List[int]] = None
    batch_id: Optional[int] = None
    bs_ket_luan: Optional[str] = "BS.CKI TRẦN VĂN HÙNG"
    cchn_bs_ket_luan: Optional[str] = "001256/KG-CCHN"
    confirm_specialty_signatures: bool = True
    confirm_conclusion_signature: bool = True
    fill_missing_defaults: bool = False


class RecheckRequest(BaseModel):
    batch_id: Optional[int] = None
    record_ids: Optional[List[int]] = None


class PrepareSigningRequest(BaseModel):
    record_ids: Optional[List[int]] = None
    batch_id: Optional[int] = None
    sign_mode: str = "STRICT_ALL"  # "STRICT_ALL" (yêu cầu tất cả phải đủ ĐK) hoặc "ELIGIBLE_ONLY" (chỉ ký các hồ sơ đủ ĐK)


class CommitSignatureRequest(BaseModel):
    package_id: str
    batch_id: Optional[int] = None
    record_ids: List[int]
    header: Dict[str, Any]
    data_base64: str
    checksum: str
    string_to_sign: str
    hospital_signature: Optional[str] = None
    record_digests: Optional[Dict[str, str]] = None
    cert_info: Dict[str, Any]
    use_soft_token_fallback: bool = False


class PushPortalRequest(BaseModel):
    record_ids: Optional[List[int]] = None
    batch_id: Optional[int] = None


# ==================== AUTH DEPENDENCY ====================
def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Thiếu hoặc sai định dạng Bearer Token")
    token = authorization.split(" ")[1]
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn hoặc không hợp lệ")
    user = get_user(payload.get("sub", ""))
    if not user:
        raise HTTPException(status_code=401, detail="Tài khoản không tồn tại hoặc đã bị khóa")
    return user


# ==================== HEALTH & AUTO-UPDATE ENDPOINTS ====================
@app.get("/api/health")
def health_check():
    cfg = get_all_configs()
    return {
        "status": "ok",
        "app": "ksk-portal-gateway",
        "version": "1.0.1",
        "hospital": cfg.get("hospital", {}).get("ten_benh_vien", "Bệnh viện Đa khoa Bình An"),
        "ma_cskcb": cfg.get("hospital", {}).get("ma_cskcb", "91034"),
    }


_INSTALLER_CACHE: Dict[str, Any] = {}


def _find_latest_client_installer() -> Optional[str]:
    patterns = [
        str(ROOT_DIR / "BinhAn KSK Portal Gateway Setup*.exe"),
        str(ROOT_DIR / "client" / "dist-release" / "BinhAn KSK Portal Gateway Setup*.exe"),
        str(ROOT_DIR / "dist-release" / "BinhAn KSK Portal Gateway Setup*.exe"),
    ]
    matches = set()
    for pat in patterns:
        for p in glob.glob(pat):
            if os.path.isfile(p):
                matches.add(os.path.abspath(p))
    return max(matches, key=os.path.getmtime) if matches else None


@app.get("/api/system/version")
def get_system_version():
    installer = _find_latest_client_installer()
    latest_ver = "1.0.1"
    size = None
    sha256_hex = None
    if installer and os.path.exists(installer):
        m = re.search(r"Setup\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)", os.path.basename(installer))
        if m:
            latest_ver = m.group(1)
        st = os.stat(installer)
        size = st.st_size
        cache_key = (installer, st.st_mtime_ns, st.st_size)
        if _INSTALLER_CACHE.get("key") != cache_key:
            h = hashlib.sha256()
            with open(installer, "rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    h.update(chunk)
            _INSTALLER_CACHE["key"] = cache_key
            _INSTALLER_CACHE["sha256"] = h.hexdigest()
        sha256_hex = _INSTALLER_CACHE["sha256"]

    return {
        "server_version": latest_ver,
        "latest_client_version": latest_ver,
        "release_notes": f"Bản cập nhật v{latest_ver}: Hệ thống Đẩy Cổng Khám Sức Khỏe Quốc Gia độc lập (Import CSV/Excel -> Check lỗi -> Ký số USB Token Client -> Đẩy Cổng).",
        "client_download_url": "/api/system/download-client",
        "client_installer_size": size,
        "client_installer_sha256": sha256_hex,
    }


@app.get("/api/system/download-client")
def download_latest_client():
    installer = _find_latest_client_installer()
    if not installer or not os.path.exists(installer):
        raise HTTPException(status_code=404, detail="Chưa tìm thấy bộ cài đặt Client trên Server")
    return FileResponse(
        installer,
        filename=os.path.basename(installer),
        media_type="application/vnd.microsoft.portable-executable",
    )


# ==================== AUTH ENDPOINTS ====================
@app.post("/api/auth/login")
def login(req: LoginRequest, request: Request):
    user = get_user(req.username.strip())
    client_ip = request.client.host if request.client else "127.0.0.1"
    if not user or not verify_password(req.password, user["password_hash"]):
        add_audit_log(req.username, "LOGIN_FAILED", "Sai tên đăng nhập hoặc mật khẩu", "FAILED", client_ip)
        raise HTTPException(status_code=400, detail="Tài khoản hoặc mật khẩu không chính xác")

    update_user_last_login(user["username"])
    add_audit_log(user["username"], "LOGIN_SUCCESS", "Đăng nhập hệ thống KSK Portal Gateway", "SUCCESS", client_ip)
    token = create_access_token(user["username"], user.get("role", "ADMIN"))
    cfg = get_all_configs()

    return {
        "success": True,
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "username": user["username"],
            "full_name": user["full_name"],
            "role": user.get("role", "ADMIN"),
            "cchn": user.get("cchn", ""),
            "hospital": cfg.get("hospital", {}).get("ten_benh_vien", "Bệnh viện Đa khoa Bình An"),
            "ma_cskcb": cfg.get("hospital", {}).get("ma_cskcb", "91034"),
        },
    }


@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    cfg = get_all_configs()
    return {
        "username": current_user["username"],
        "full_name": current_user["full_name"],
        "role": current_user.get("role", "ADMIN"),
        "cchn": current_user.get("cchn", ""),
        "hospital": cfg.get("hospital", {}).get("ten_benh_vien", "Bệnh viện Đa khoa Bình An"),
        "ma_cskcb": cfg.get("hospital", {}).get("ma_cskcb", "91034"),
    }


# ==================== CONFIG ENDPOINTS ====================
@app.get("/api/configs")
def get_configs_endpoint(current_user: dict = Depends(get_current_user)):
    cfg = get_all_configs()
    portal = dict(cfg.get("portal", {}))
    if portal.get("password"):
        portal["has_password"] = True
        portal["password"] = ""
    else:
        portal["has_password"] = False
    return {"success": True, "hospital": cfg.get("hospital", {}), "portal": portal}


@app.put("/api/configs")
def update_configs_endpoint(req: ConfigSaveRequest, request: Request, current_user: dict = Depends(get_current_user)):
    if req.hospital:
        save_config_section("hospital", req.hospital)
    if req.portal:
        existing_portal = get_all_configs().get("portal", {})
        portal_update = dict(req.portal)
        if not portal_update.get("password") and existing_portal.get("password"):
            portal_update["password"] = existing_portal["password"]
        save_config_section("portal", portal_update)

    client_ip = request.client.host if request.client else "127.0.0.1"
    add_audit_log(current_user["username"], "UPDATE_CONFIG", "Cập nhật cấu hình Đơn vị & Cổng KSK Quốc gia", "SUCCESS", client_ip)
    return {"success": True, "message": "Đã lưu cấu hình hệ thống thành công"}


# ==================== TEMPLATE DOWNLOAD ENDPOINTS ====================
@app.get("/api/templates/download/{fmt}")
def download_template(fmt: str):
    fmt_clean = fmt.lower().strip()
    if fmt_clean == "csv":
        data = build_sample_csv_bytes()
        return Response(
            content=data,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="mau_import_ksk_quoc_gia.csv"'},
        )
    elif fmt_clean in ("xlsx", "excel"):
        data = build_sample_excel_bytes()
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="mau_import_ksk_quoc_gia.xlsx"'},
        )
    raise HTTPException(status_code=400, detail="Chỉ hỗ trợ tải file mẫu định dạng 'xlsx' hoặc 'csv'")


# ==================== BƯỚC 1: IMPORT FILE CSV / EXCEL ====================
@app.post("/api/batches/import")
async def import_file_batch(
    request: Request,
    file: UploadFile = File(...),
    notes: Optional[str] = Form(""),
    current_user: dict = Depends(get_current_user),
):
    """
    Nhập dữ liệu hồ sơ KSK từ file CSV (.csv) hoặc Excel (.xlsx, .xls).
    Tự động chuẩn hóa các cột và chạy kiểm tra (Pre-check) toàn bộ các trường,
    chữ ký chuyên khoa và chữ ký kết luận ngay khi import.
    """
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in (".csv", ".xlsx", ".xls"):
        raise HTTPException(
            status_code=400,
            detail=f"Định dạng file '{ext}' không được hỗ trợ! Hệ thống hiện tại chỉ hỗ trợ import file CSV (.csv) và Excel (.xlsx, .xls).",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File tải lên rỗng, không có dữ liệu.")

    try:
        file_type, normalized_records = parse_uploaded_file(filename, content)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Lỗi đọc file {filename}: {str(e)}")

    now = now_vn_str()
    ts_code = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_code = f"LO_{ts_code}"

    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            """
            INSERT INTO import_batches (
                batch_code, filename, file_type, exam_type,
                total_records, eligible_count, invalid_count, signed_count, synced_count,
                notes, created_by, created_at
            )
            VALUES (?, ?, ?, 'MIXED', 0, 0, 0, 0, 0, ?, ?, ?)
            """,
            (batch_code, filename, file_type, notes or f"Import từ file {filename}", current_user["username"], now),
        )
        batch_id = cur.lastrowid

        eligible_cnt = 0
        invalid_cnt = 0

        for idx, norm in enumerate(normalized_records, start=1):
            val = validate_ksk_record(norm)
            is_el = 1 if val["is_eligible"] else 0
            if is_el:
                eligible_cnt += 1
            else:
                invalid_cnt += 1

            cur.execute(
                """
                INSERT INTO ksk_records (
                    batch_id, batch_code, row_index, ma_kcb, ma_benh_nhan,
                    ho_va_ten, so_cccd, ngay_sinh, gioi_tinh, ngay_kham,
                    loai_ksk, phan_loai_sk, bs_ket_luan, cchn_bs_ket_luan,
                    has_conclusion_signature, has_specialty_signatures,
                    is_eligible, error_count, warning_count,
                    record_json, validation_json,
                    signing_status, sync_status, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNSIGNED', 'PENDING', ?)
                """,
                (
                    batch_id,
                    batch_code,
                    idx,
                    norm.get("ma_kcb", ""),
                    norm.get("ma_benh_nhan", ""),
                    norm.get("ho_va_ten", ""),
                    norm.get("so_cccd", ""),
                    norm.get("ngay_sinh", ""),
                    norm.get("gioi_tinh", ""),
                    norm.get("ngay_kham", ""),
                    norm.get("loai_ksk", "DINH_KY"),
                    norm.get("phan_loai_sk", ""),
                    norm.get("bs_ket_luan", ""),
                    norm.get("cchn_bs_ket_luan", ""),
                    1 if val["has_conclusion_signature"] else 0,
                    1 if val["has_specialty_signatures"] else 0,
                    is_el,
                    val["error_count"],
                    val["warning_count"],
                    json.dumps(norm, ensure_ascii=False),
                    json.dumps(val, ensure_ascii=False),
                    now,
                ),
            )

        conn.commit()
    finally:
        cur.close()
        conn.close()

    refresh_batch_counters(batch_id)

    client_ip = request.client.host if request.client else "127.0.0.1"
    add_audit_log(
        current_user["username"],
        "IMPORT_FILE",
        f"Import file {file_type} '{filename}' ({len(normalized_records)} hồ sơ: {eligible_cnt} đủ ĐK, {invalid_cnt} thiếu thông tin)",
        "SUCCESS",
        client_ip,
    )

    return {
        "success": True,
        "message": f"Đã import thành công {len(normalized_records)} hồ sơ từ file '{filename}'",
        "batch": {
            "id": batch_id,
            "batch_code": batch_code,
            "filename": filename,
            "file_type": file_type,
            "total_records": len(normalized_records),
            "eligible_count": eligible_cnt,
            "invalid_count": invalid_cnt,
        },
    }


@app.get("/api/batches")
def list_batches(current_user: dict = Depends(get_current_user)):
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM import_batches ORDER BY id DESC").fetchall()
        return {"success": True, "data": [dict(r) for r in rows]}
    finally:
        conn.close()


@app.delete("/api/batches/{batch_id}")
def delete_batch(batch_id: int, request: Request, current_user: dict = Depends(get_current_user)):
    conn = get_conn()
    try:
        b = conn.execute("SELECT * FROM import_batches WHERE id = ?", (batch_id,)).fetchone()
        if not b:
            raise HTTPException(status_code=404, detail="Không tìm thấy lô import")
        conn.execute("DELETE FROM ksk_records WHERE batch_id = ?", (batch_id,))
        conn.execute("DELETE FROM import_batches WHERE id = ?", (batch_id,))
        conn.commit()
        client_ip = request.client.host if request.client else "127.0.0.1"
        add_audit_log(
            current_user["username"],
            "DELETE_BATCH",
            f"Xóa lô import {b['batch_code']} ({b['filename']})",
            "SUCCESS",
            client_ip,
        )
        return {"success": True, "message": f"Đã xóa lô {b['batch_code']}"}
    finally:
        conn.close()


# ==================== BƯỚC 2: TRA CỨU, KIỂM TRA (PRE-CHECK) & BỔ SUNG THÔNG TIN ====================
def _build_record_where_clause(
    batch_id: Optional[int],
    search: Optional[str],
    loai_ksk: Optional[str],
    stage_filter: Optional[str],
):
    clauses = ["1=1"]
    params: List[Any] = []

    if batch_id:
        clauses.append("batch_id = ?")
        params.append(batch_id)

    if loai_ksk and loai_ksk not in ("ALL", ""):
        clauses.append("loai_ksk = ?")
        params.append(loai_ksk)

    if search and search.strip():
        q = f"%{search.strip()}%"
        clauses.append("(ma_kcb LIKE ? OR ho_va_ten LIKE ? OR so_cccd LIKE ? OR ma_benh_nhan LIKE ?)")
        params.extend([q, q, q, q])

    if stage_filter and stage_filter not in ("ALL", ""):
        sf = stage_filter.upper()
        if sf == "INVALID":
            clauses.append("is_eligible = 0")
        elif sf == "ELIGIBLE":
            clauses.append("is_eligible = 1")
        elif sf == "UNSIGNED_ELIGIBLE":
            clauses.append("is_eligible = 1 AND signing_status = 'UNSIGNED'")
        elif sf == "SIGNED":
            clauses.append("signing_status = 'SIGNED' AND sync_status != 'SYNCED'")
        elif sf == "SIGNED_ALL":
            clauses.append("signing_status = 'SIGNED'")
        elif sf == "SYNCED":
            clauses.append("sync_status = 'SYNCED'")
        elif sf == "SYNC_FAILED":
            clauses.append("sync_status = 'FAILED'")

    return " AND ".join(clauses), params


def _serialize_record_row(r: sqlite3.Row) -> Dict[str, Any]:
    d = dict(r)
    try:
        d["record_data"] = json.loads(d.pop("record_json", "{}"))
    except Exception:
        d["record_data"] = {}
    try:
        d["validation"] = json.loads(d.pop("validation_json", "{}"))
    except Exception:
        d["validation"] = {}
    d["is_eligible"] = bool(d.get("is_eligible"))
    d["has_conclusion_signature"] = bool(d.get("has_conclusion_signature"))
    d["has_specialty_signatures"] = bool(d.get("has_specialty_signatures"))
    return d


@app.get("/api/records")
def list_records(
    batch_id: Optional[int] = None,
    search: Optional[str] = None,
    loai_ksk: Optional[str] = None,
    stage_filter: Optional[str] = None,
    page: int = 1,
    page_size: int = 15,
    current_user: dict = Depends(get_current_user),
):
    page = max(1, int(page))
    page_size = max(1, min(200, int(page_size)))
    where_sql, params = _build_record_where_clause(batch_id, search, loai_ksk, stage_filter)

    conn = get_conn()
    try:
        total = conn.execute(f"SELECT COUNT(*) as cnt FROM ksk_records WHERE {where_sql}", params).fetchone()["cnt"]
        offset = (page - 1) * page_size
        rows = conn.execute(
            f"SELECT * FROM ksk_records WHERE {where_sql} ORDER BY batch_id DESC, row_index ASC LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()
        return {
            "success": True,
            "total": total,
            "page": page,
            "page_size": page_size,
            "data": [_serialize_record_row(r) for r in rows],
        }
    finally:
        conn.close()


@app.get("/api/records/stats")
def get_records_stats(
    batch_id: Optional[int] = None,
    search: Optional[str] = None,
    loai_ksk: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    where_sql, params = _build_record_where_clause(batch_id, search, loai_ksk, None)
    conn = get_conn()
    try:
        row = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN is_eligible = 0 THEN 1 ELSE 0 END) AS invalid_count,
                SUM(CASE WHEN is_eligible = 1 THEN 1 ELSE 0 END) AS eligible_total_count,
                SUM(CASE WHEN is_eligible = 1 AND signing_status = 'UNSIGNED' THEN 1 ELSE 0 END) AS eligible_unsigned_count,
                SUM(CASE WHEN signing_status = 'SIGNED' AND sync_status != 'SYNCED' THEN 1 ELSE 0 END) AS signed_ready_count,
                SUM(CASE WHEN signing_status = 'SIGNED' THEN 1 ELSE 0 END) AS signed_total_count,
                SUM(CASE WHEN sync_status = 'SYNCED' THEN 1 ELSE 0 END) AS synced_count,
                SUM(CASE WHEN sync_status = 'FAILED' THEN 1 ELSE 0 END) AS sync_failed_count
            FROM ksk_records
            WHERE {where_sql}
            """,
            params,
        ).fetchone()
        return {
            "success": True,
            "total": row["total"] or 0,
            "invalid_count": row["invalid_count"] or 0,
            "eligible_total_count": row["eligible_total_count"] or 0,
            "eligible_unsigned_count": row["eligible_unsigned_count"] or 0,
            "signed_ready_count": row["signed_ready_count"] or 0,
            "signed_total_count": row["signed_total_count"] or 0,
            "synced_count": row["synced_count"] or 0,
            "sync_failed_count": row["sync_failed_count"] or 0,
        }
    finally:
        conn.close()


@app.get("/api/records/select-ids")
def select_record_ids(
    batch_id: Optional[int] = None,
    search: Optional[str] = None,
    loai_ksk: Optional[str] = None,
    stage_filter: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    where_sql, params = _build_record_where_clause(batch_id, search, loai_ksk, stage_filter)
    conn = get_conn()
    try:
        rows = conn.execute(
            f"SELECT id, ma_kcb, ho_va_ten, so_cccd, is_eligible, signing_status, sync_status FROM ksk_records WHERE {where_sql} ORDER BY id ASC",
            params,
        ).fetchall()
        return {
            "success": True,
            "data": [
                {
                    "id": r["id"],
                    "ma_kcb": r["ma_kcb"],
                    "ho_va_ten": r["ho_va_ten"],
                    "so_cccd": r["so_cccd"],
                    "is_eligible": bool(r["is_eligible"]),
                    "signing_status": r["signing_status"],
                    "sync_status": r["sync_status"],
                }
                for r in rows
            ],
        }
    finally:
        conn.close()


@app.get("/api/records/{record_id}")
def get_record_detail(record_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_conn()
    try:
        r = conn.execute("SELECT * FROM ksk_records WHERE id = ?", (record_id,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Không tìm thấy hồ sơ KSK")
        return {"success": True, "data": _serialize_record_row(r)}
    finally:
        conn.close()


@app.put("/api/records/{record_id}")
def update_record_fields(
    record_id: int,
    req: RecordUpdateRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Cập nhật / bổ sung các trường thông tin còn thiếu của 1 hồ sơ KSK,
    sau đó tự động chạy lại bộ máy kiểm tra (Pre-check).
    Nếu hồ sơ đã từng ký số trước đó, khi thay đổi nội dung sẽ yêu cầu ký số lại để đảm bảo toàn vẹn.
    """
    conn = get_conn()
    try:
        r = conn.execute("SELECT * FROM ksk_records WHERE id = ?", (record_id,)).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Không tìm thấy hồ sơ KSK")

        rec_data = json.loads(r["record_json"])
        for k, v in req.fields.items():
            rec_data[k] = "" if v is None else str(v).strip()

        # Tự động tính lại BMI nếu sửa chiều cao / cân nặng
        if ("chieu_cao" in req.fields or "can_nang" in req.fields) and not req.fields.get("bmi"):
            try:
                cc = float(str(rec_data.get("chieu_cao", "0")).replace(",", "."))
                cn = float(str(rec_data.get("can_nang", "0")).replace(",", "."))
                if cc > 0 and cn > 0:
                    rec_data["bmi"] = str(round(cn / ((cc / 100.0) ** 2), 2))
            except Exception:
                pass

        val = validate_ksk_record(rec_data)
        now = now_vn_str()

        conn.execute(
            """
            UPDATE ksk_records
            SET ma_kcb = ?,
                ma_benh_nhan = ?,
                ho_va_ten = ?,
                so_cccd = ?,
                ngay_sinh = ?,
                gioi_tinh = ?,
                ngay_kham = ?,
                loai_ksk = ?,
                phan_loai_sk = ?,
                bs_ket_luan = ?,
                cchn_bs_ket_luan = ?,
                has_conclusion_signature = ?,
                has_specialty_signatures = ?,
                is_eligible = ?,
                error_count = ?,
                warning_count = ?,
                record_json = ?,
                validation_json = ?,
                signing_status = 'UNSIGNED',
                hospital_signature = '',
                updated_at = ?
            WHERE id = ?
            """,
            (
                rec_data.get("ma_kcb", ""),
                rec_data.get("ma_benh_nhan", ""),
                rec_data.get("ho_va_ten", ""),
                rec_data.get("so_cccd", ""),
                rec_data.get("ngay_sinh", ""),
                rec_data.get("gioi_tinh", ""),
                rec_data.get("ngay_kham", ""),
                val["loai_ksk"],
                rec_data.get("phan_loai_sk", ""),
                rec_data.get("bs_ket_luan", ""),
                rec_data.get("cchn_bs_ket_luan", ""),
                1 if val["has_conclusion_signature"] else 0,
                1 if val["has_specialty_signatures"] else 0,
                1 if val["is_eligible"] else 0,
                val["error_count"],
                val["warning_count"],
                json.dumps(rec_data, ensure_ascii=False),
                json.dumps(val, ensure_ascii=False),
                now,
                record_id,
            ),
        )
        conn.commit()
        refresh_batch_counters(r["batch_id"])

        updated_row = conn.execute("SELECT * FROM ksk_records WHERE id = ?", (record_id,)).fetchone()
        client_ip = request.client.host if request.client else "127.0.0.1"
        add_audit_log(
            current_user["username"],
            "UPDATE_RECORD",
            f"Cập nhật thông tin hồ sơ {rec_data.get('ma_kcb')} ({rec_data.get('ho_va_ten')}) -> Đủ ĐK: {val['is_eligible']}",
            "SUCCESS",
            client_ip,
        )
        return {
            "success": True,
            "message": "Đã lưu thông tin và kiểm tra lại hồ sơ thành công",
            "data": _serialize_record_row(updated_row),
        }
    finally:
        conn.close()


@app.post("/api/records/bulk-complete")
def bulk_complete_records(
    req: BulkCompleteRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Hỗ trợ xác nhận nhanh chữ ký chuyên khoa, chữ ký bác sĩ kết luận và điền giá trị mặc định
    cho các trường khám lâm sàng/cận lâm sàng bị bỏ trống trên file Excel/CSV.
    """
    conn = get_conn()
    try:
        if req.record_ids:
            placeholders = ",".join(["?"] * len(req.record_ids))
            rows = conn.execute(f"SELECT * FROM ksk_records WHERE id IN ({placeholders})", req.record_ids).fetchall()
        elif req.batch_id:
            rows = conn.execute("SELECT * FROM ksk_records WHERE batch_id = ?", (req.batch_id,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM ksk_records WHERE is_eligible = 0").fetchall()

        if not rows:
            raise HTTPException(status_code=400, detail="Không có hồ sơ nào được chọn để hoàn thiện")

        now = now_vn_str()
        touched_batches = set()
        newly_eligible = 0

        for r in rows:
            touched_batches.add(r["batch_id"])
            rec_data = json.loads(r["record_json"])

            if req.confirm_specialty_signatures:
                rec_data["chuky_chuyen_khoa"] = "Đã ký đủ"
            if req.confirm_conclusion_signature:
                rec_data["chuky_ket_luan"] = "Đã ký"
            if req.bs_ket_luan and not rec_data.get("bs_ket_luan"):
                rec_data["bs_ket_luan"] = req.bs_ket_luan
            if req.cchn_bs_ket_luan and not rec_data.get("cchn_bs_ket_luan"):
                rec_data["cchn_bs_ket_luan"] = req.cchn_bs_ket_luan

            if req.fill_missing_defaults:
                if not rec_data.get("chieu_cao"):
                    rec_data["chieu_cao"] = "165"
                if not rec_data.get("can_nang"):
                    rec_data["can_nang"] = "60"
                if not rec_data.get("bmi"):
                    rec_data["bmi"] = "22.04"
                if not rec_data.get("mach"):
                    rec_data["mach"] = "75"
                if not rec_data.get("huyet_ap"):
                    rec_data["huyet_ap"] = "120/80"
                if not rec_data.get("phan_loai_sk"):
                    rec_data["phan_loai_sk"] = "DU_DIEU_KIEN" if rec_data.get("loai_ksk") == "LAI_XE" else "LOAI_I"
                for k_field in (
                    "kham_noi_khoa", "kham_ngoai_khoa", "kham_da_lieu", "kham_mat",
                    "kham_tmh", "kham_rhm", "kham_san_phu_khoa",
                    "x_quang_phoi", "cong_thuc_mau", "xet_nghiem_nuoc_tieu",
                ):
                    if not rec_data.get(k_field):
                        rec_data[k_field] = "Bình thường"

            val = validate_ksk_record(rec_data)
            if val["is_eligible"]:
                newly_eligible += 1

            conn.execute(
                """
                UPDATE ksk_records
                SET phan_loai_sk = ?,
                    bs_ket_luan = ?,
                    cchn_bs_ket_luan = ?,
                    has_conclusion_signature = ?,
                    has_specialty_signatures = ?,
                    is_eligible = ?,
                    error_count = ?,
                    warning_count = ?,
                    record_json = ?,
                    validation_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    rec_data.get("phan_loai_sk", ""),
                    rec_data.get("bs_ket_luan", ""),
                    rec_data.get("cchn_bs_ket_luan", ""),
                    1 if val["has_conclusion_signature"] else 0,
                    1 if val["has_specialty_signatures"] else 0,
                    1 if val["is_eligible"] else 0,
                    val["error_count"],
                    val["warning_count"],
                    json.dumps(rec_data, ensure_ascii=False),
                    json.dumps(val, ensure_ascii=False),
                    now,
                    r["id"],
                ),
            )

        conn.commit()
        for bid in touched_batches:
            refresh_batch_counters(bid)

        client_ip = request.client.host if request.client else "127.0.0.1"
        add_audit_log(
            current_user["username"],
            "BULK_COMPLETE",
            f"Hoàn thiện nhanh {len(rows)} hồ sơ -> {newly_eligible}/{len(rows)} hồ sơ đạt chuẩn",
            "SUCCESS",
            client_ip,
        )
        return {
            "success": True,
            "processed_count": len(rows),
            "eligible_count": newly_eligible,
            "message": f"Đã cập nhật và kiểm tra lại {len(rows)} hồ sơ ({newly_eligible} hồ sơ đủ điều kiện ký số).",
        }
    finally:
        conn.close()


@app.post("/api/records/recheck")
def recheck_records(req: RecheckRequest, current_user: dict = Depends(get_current_user)):
    """
    Chạy kiểm tra (Check) lại toàn bộ hồ sơ trong lô hoặc danh sách chọn trước khi thực hiện Ký số.
    Báo cáo chi tiết hồ sơ nào còn thiếu thông tin và hồ sơ nào đã đầy đủ.
    """
    conn = get_conn()
    try:
        if req.record_ids:
            placeholders = ",".join(["?"] * len(req.record_ids))
            rows = conn.execute(f"SELECT * FROM ksk_records WHERE id IN ({placeholders})", req.record_ids).fetchall()
        elif req.batch_id:
            rows = conn.execute("SELECT * FROM ksk_records WHERE batch_id = ?", (req.batch_id,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM ksk_records").fetchall()

        now = now_vn_str()
        eligible_list = []
        incomplete_list = []
        touched_batches = set()

        for r in rows:
            touched_batches.add(r["batch_id"])
            rec_data = json.loads(r["record_json"])
            val = validate_ksk_record(rec_data)

            conn.execute(
                """
                UPDATE ksk_records
                SET has_conclusion_signature = ?,
                    has_specialty_signatures = ?,
                    is_eligible = ?,
                    error_count = ?,
                    warning_count = ?,
                    validation_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    1 if val["has_conclusion_signature"] else 0,
                    1 if val["has_specialty_signatures"] else 0,
                    1 if val["is_eligible"] else 0,
                    val["error_count"],
                    val["warning_count"],
                    json.dumps(val, ensure_ascii=False),
                    now,
                    r["id"],
                ),
            )

            summary_item = {
                "id": r["id"],
                "ma_kcb": r["ma_kcb"],
                "ho_va_ten": r["ho_va_ten"],
                "so_cccd": r["so_cccd"],
                "error_count": val["error_count"],
                "missing_fields": val["missing_fields"],
                "signing_status": r["signing_status"],
            }
            if val["is_eligible"]:
                eligible_list.append(summary_item)
            else:
                incomplete_list.append(summary_item)

        conn.commit()
        for bid in touched_batches:
            refresh_batch_counters(bid)

        return {
            "success": True,
            "total_checked": len(rows),
            "all_complete": len(incomplete_list) == 0 and len(eligible_list) > 0,
            "eligible_count": len(eligible_list),
            "incomplete_count": len(incomplete_list),
            "eligible_records": eligible_list,
            "incomplete_records": incomplete_list,
        }
    finally:
        conn.close()


# ==================== BƯỚC 3: KÝ SỐ ĐIỆN TỬ BỆNH VIỆN (1 LẦN CHO TẤT CẢ HỒ SƠ ĐỦ ĐK) ====================
@app.post("/api/records/prepare-signing")
def prepare_signing_endpoint(req: PrepareSigningRequest, current_user: dict = Depends(get_current_user)):
    """
    Bước 3A: Kiểm tra điều kiện nghiêm ngặt trước khi Ký số Bệnh viện.
    - Đầu tiên kiểm tra hồ sơ nào còn thiếu thông tin.
    - Nếu sign_mode == 'STRICT_ALL' mà còn hồ sơ thiếu thông tin -> Chặn ký và trả về danh sách hồ sơ thiếu,
      đồng thời cho phép người dùng chọn ký số riêng đối với những hồ sơ đã đầy đủ thông tin ('ELIGIBLE_ONLY').
    - Tạo gói Digest (string_to_sign) duy nhất để USB Token cắm tại máy Client ký số 1 lần cho toàn bộ hồ sơ hợp lệ.
    """
    conn = get_conn()
    try:
        if req.record_ids:
            placeholders = ",".join(["?"] * len(req.record_ids))
            rows = conn.execute(
                f"SELECT * FROM ksk_records WHERE id IN ({placeholders}) ORDER BY id ASC",
                req.record_ids,
            ).fetchall()
        elif req.batch_id:
            rows = conn.execute(
                "SELECT * FROM ksk_records WHERE batch_id = ? ORDER BY id ASC",
                (req.batch_id,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM ksk_records ORDER BY id ASC").fetchall()

        if not rows:
            raise HTTPException(status_code=400, detail="Không tìm thấy hồ sơ nào để chuẩn bị ký số")

        eligible_rows = []
        incomplete_rows = []

        for r in rows:
            rec_data = json.loads(r["record_json"])
            val = validate_ksk_record(rec_data)
            if val["is_eligible"]:
                eligible_rows.append({"id": r["id"], "batch_id": r["batch_id"], "record_data": rec_data, "row": r})
            else:
                incomplete_rows.append(
                    {
                        "id": r["id"],
                        "ma_kcb": r["ma_kcb"],
                        "ho_va_ten": r["ho_va_ten"],
                        "so_cccd": r["so_cccd"],
                        "error_count": val["error_count"],
                        "missing_fields": val["missing_fields"],
                    }
                )

        # Nếu người dùng bấm Ký số toàn bộ nhưng vẫn còn hồ sơ thiếu thông tin
        if req.sign_mode == "STRICT_ALL" and len(incomplete_rows) > 0:
            return {
                "success": True,
                "can_sign": False,
                "reason": "INCOMPLETE_RECORDS_FOUND",
                "message": (
                    f"Phát hiện {len(incomplete_rows)}/{len(rows)} hồ sơ còn thiếu thông tin hoặc chưa có chữ ký kết luận! "
                    f"Vui lòng bổ sung đầy đủ thông tin trước khi ký toàn bộ, hoặc chọn 'Ký số cho {len(eligible_rows)} hồ sơ đã đầy đủ thông tin'."
                ),
                "total_requested": len(rows),
                "eligible_count": len(eligible_rows),
                "incomplete_count": len(incomplete_rows),
                "incomplete_records": incomplete_rows,
                "eligible_record_ids": [item["id"] for item in eligible_rows],
            }

        if len(eligible_rows) == 0:
            return {
                "success": True,
                "can_sign": False,
                "reason": "NO_ELIGIBLE_RECORDS",
                "message": "Không có hồ sơ nào đủ điều kiện (đầy đủ thông tin & chữ ký kết luận) để thực hiện ký số Bệnh viện.",
                "total_requested": len(rows),
                "eligible_count": 0,
                "incomplete_count": len(incomplete_rows),
                "incomplete_records": incomplete_rows,
                "eligible_record_ids": [],
            }

        cfg = get_all_configs()
        ma_cskcb = cfg.get("hospital", {}).get("ma_cskcb", "91034")
        signing_pkg = prepare_batch_signing_payload(eligible_rows, ma_cskcb=ma_cskcb)

        return {
            "success": True,
            "can_sign": True,
            "message": f"Đã kiểm tra hợp lệ 100% ({len(eligible_rows)} hồ sơ). Sẵn sàng ký số điện tử Bệnh viện (1 lần cho toàn bộ {len(eligible_rows)} hồ sơ).",
            "total_requested": len(rows),
            "eligible_count": len(eligible_rows),
            "incomplete_count": len(incomplete_rows),
            "incomplete_records": incomplete_rows,
            "eligible_record_ids": [item["id"] for item in eligible_rows],
            "signing_package": signing_pkg,
        }
    finally:
        conn.close()


@app.post("/api/records/commit-signature")
def commit_signature_endpoint(
    req: CommitSignatureRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Bước 3B: Nhận chữ ký số điện tử của Bệnh viện (từ USB Token cắm trực tiếp ở máy Client)
    và gắn vào toàn bộ hồ sơ đã chọn.
    Lưu ý: Sau khi ký số xong, trạng thái hồ sơ chuyển sang 'SIGNED' (Đã ký số BV).
    Hệ thống CHƯA tự động đẩy lên Cổng cho tới khi người dùng bấm nút 'Đẩy dữ liệu lên Cổng'.
    """
    if not req.record_ids:
        raise HTTPException(status_code=400, detail="Danh sách hồ sơ ký số trống")

    conn = get_conn()
    try:
        placeholders = ",".join(["?"] * len(req.record_ids))
        rows = conn.execute(
            f"SELECT * FROM ksk_records WHERE id IN ({placeholders})",
            req.record_ids,
        ).fetchall()

        if len(rows) != len(req.record_ids):
            raise HTTPException(status_code=400, detail="Một số hồ sơ trong danh sách ký không tồn tại")

        # Chốt chặn an toàn phía Server: Không cho phép bất kỳ hồ sơ thiếu thông tin nào lọt qua bước ký số
        for r in rows:
            if not r["is_eligible"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Hồ sơ {r['ma_kcb']} ({r['ho_va_ten']}) còn thiếu thông tin bắt buộc, không được phép ký số!",
                )

        signature_str = (req.hospital_signature or "").strip()
        if req.use_soft_token_fallback or not signature_str:
            signature_str = sign_string_with_soft_token(req.string_to_sign)

        cert_info = req.cert_info or {}
        cert_serial = cert_info.get("serialNumber") or cert_info.get("serial_number") or "SN-91034-2026"
        cert_subject = cert_info.get("subject") or "CN=BỆNH VIỆN ĐA KHOA BÌNH AN, OID.0.9.2342.19200300.100.1.1=MST:1700335853"
        cert_issuer = cert_info.get("issuer") or "CN=Viettel-CA, O=Viettel Group, C=VN"
        cert_thumbprint = cert_info.get("thumbprint") or "USB_TOKEN_CLIENT_91034"

        now = now_vn_str()
        batch_id = req.batch_id or rows[0]["batch_id"]

        conn.execute(
            """
            INSERT OR REPLACE INTO signed_packages (
                package_id, batch_id, record_ids_json, record_count,
                header_json, data_base64, checksum, string_to_sign,
                hospital_signature, cert_info_json, signed_by, signed_at, push_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY_TO_PUSH')
            """,
            (
                req.package_id,
                batch_id,
                json.dumps(req.record_ids),
                len(req.record_ids),
                json.dumps(req.header, ensure_ascii=False),
                req.data_base64,
                req.checksum,
                req.string_to_sign,
                signature_str,
                json.dumps(cert_info, ensure_ascii=False),
                current_user["username"],
                now,
            ),
        )

        digests_map = req.record_digests or {}
        touched_batches = set()

        for r in rows:
            touched_batches.add(r["batch_id"])
            rec_digest = digests_map.get(str(r["id"]), req.checksum)
            conn.execute(
                """
                UPDATE ksk_records
                SET signing_status = 'SIGNED',
                    hospital_signature = ?,
                    hospital_record_digest = ?,
                    cert_serial = ?,
                    cert_subject = ?,
                    cert_issuer = ?,
                    cert_thumbprint = ?,
                    signed_at = ?,
                    signed_by = ?,
                    signed_package_id = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    signature_str,
                    rec_digest,
                    cert_serial,
                    cert_subject,
                    cert_issuer,
                    cert_thumbprint,
                    now,
                    current_user["username"],
                    req.package_id,
                    now,
                    r["id"],
                ),
            )

        conn.commit()
        for bid in touched_batches:
            refresh_batch_counters(bid)

        client_ip = request.client.host if request.client else "127.0.0.1"
        add_audit_log(
            current_user["username"],
            "HOSPITAL_BATCH_SIGN",
            f"Ký số điện tử Bệnh viện (1 lần) cho {len(rows)} hồ sơ - Mã gói: {req.package_id} - Chứng thư số: {cert_subject}",
            "SUCCESS",
            client_ip,
        )

        return {
            "success": True,
            "package_id": req.package_id,
            "signed_count": len(rows),
            "signed_at": now,
            "cert_subject": cert_subject,
            "cert_serial": cert_serial,
            "signature_preview": signature_str[:64] + "...",
            "message": f"Đã ký số điện tử Bệnh viện thành công cho {len(rows)} hồ sơ! Bây giờ bạn có thể bấm 'Đẩy dữ liệu lên Cổng'.",
        }
    finally:
        conn.close()


# ==================== BƯỚC 4: ĐẨY DỮ LIỆU ĐÃ KÝ SỐ LÊN CỔNG QUỐC GIA ====================
@app.post("/api/records/push-portal")
def push_to_portal_endpoint(
    req: PushPortalRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Bước 4: Thực sự đẩy dữ liệu lên Cổng Quốc gia.
    CHỈ cho phép đẩy những hồ sơ ĐÃ ĐƯỢC KÝ SỐ ĐIỆN TỬ BỆNH VIỆN (signing_status == 'SIGNED').
    """
    conn = get_conn()
    try:
        if req.record_ids:
            placeholders = ",".join(["?"] * len(req.record_ids))
            rows = conn.execute(
                f"SELECT * FROM ksk_records WHERE id IN ({placeholders}) ORDER BY id ASC",
                req.record_ids,
            ).fetchall()
        elif req.batch_id:
            rows = conn.execute(
                "SELECT * FROM ksk_records WHERE batch_id = ? AND signing_status = 'SIGNED' AND sync_status != 'SYNCED' ORDER BY id ASC",
                (req.batch_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM ksk_records WHERE signing_status = 'SIGNED' AND sync_status != 'SYNCED' ORDER BY id ASC"
            ).fetchall()

        if not rows:
            raise HTTPException(
                status_code=400,
                detail="Không có hồ sơ nào ở trạng thái 'Đã ký số Bệnh viện' để đẩy lên Cổng! Vui lòng thực hiện Ký số trước.",
            )

        unsigned_list = [f"{r['ma_kcb']} ({r['ho_va_ten']})" for r in rows if r["signing_status"] != "SIGNED" or not r["hospital_signature"]]
        if unsigned_list:
            raise HTTPException(
                status_code=400,
                detail=f"Phát hiện {len(unsigned_list)} hồ sơ CHƯA KÝ SỐ ĐIỆN TỬ BỆNH VIỆN ({', '.join(unsigned_list[:3])}). Bắt buộc phải ký số xong mới được đẩy lên Cổng!",
            )

        cfg = get_all_configs()
        ma_cskcb = cfg.get("hospital", {}).get("ma_cskcb", "91034")

        # Kiểm tra xem các hồ sơ này có cùng thuộc 1 signed_package đã tạo sẵn không
        pkg_ids = list({r["signed_package_id"] for r in rows if r["signed_package_id"]})
        envelope = None
        package_id = None

        if len(pkg_ids) == 1:
            pkg_row = conn.execute("SELECT * FROM signed_packages WHERE package_id = ?", (pkg_ids[0],)).fetchone()
            if pkg_row and pkg_row["record_count"] == len(rows):
                package_id = pkg_row["package_id"]
                envelope = {
                    "header": json.loads(pkg_row["header_json"]),
                    "data": pkg_row["data_base64"],
                    "signature": pkg_row["hospital_signature"],
                    "checksum": pkg_row["checksum"],
                }

        # Nếu người dùng chọn một tập con các hồ sơ đã ký số để đẩy
        if not envelope:
            db_recs = [{"id": r["id"], "record_data": json.loads(r["record_json"])} for r in rows]
            prep = prepare_batch_signing_payload(db_recs, ma_cskcb=ma_cskcb)
            package_id = prep["package_id"]
            # Sử dụng chữ ký số bệnh viện đã ký trên lô của các hồ sơ này
            sig_to_use = rows[0]["hospital_signature"]
            envelope = {
                "header": prep["header"],
                "data": prep["data_base64"],
                "signature": sig_to_use,
                "checksum": prep["checksum"],
            }

        batch_id = rows[0]["batch_id"]
        push_res = portal_client.push_signed_envelope(
            envelope=envelope,
            package_id=package_id,
            batch_id=batch_id,
            record_count=len(rows),
            sender_username=current_user["username"],
        )

        now = now_vn_str()
        is_ok = bool(push_res.get("success"))
        new_sync_status = "SYNCED" if is_ok else "FAILED"
        portal_msg_id = push_res.get("portal_msg_id") or package_id
        resp_summary = json.dumps(push_res.get("data") or {"error": push_res.get("error")}, ensure_ascii=False)

        touched_batches = set()
        for r in rows:
            touched_batches.add(r["batch_id"])
            conn.execute(
                """
                UPDATE ksk_records
                SET sync_status = ?,
                    portal_msg_id = ?,
                    synced_at = ?,
                    synced_by = ?,
                    sync_response = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    new_sync_status,
                    portal_msg_id if is_ok else None,
                    now if is_ok else None,
                    current_user["username"],
                    resp_summary,
                    now,
                    r["id"],
                ),
            )

        if len(pkg_ids) == 1:
            conn.execute(
                """
                UPDATE signed_packages
                SET push_status = ?, pushed_at = ?, portal_response_json = ?
                WHERE package_id = ?
                """,
                ("PUSHED_OK" if is_ok else "PUSH_FAILED", now, resp_summary, pkg_ids[0]),
            )

        conn.commit()
        for bid in touched_batches:
            refresh_batch_counters(bid)

        client_ip = request.client.host if request.client else "127.0.0.1"
        add_audit_log(
            current_user["username"],
            "PUSH_NATIONAL_PORTAL",
            f"Đẩy {len(rows)} hồ sơ KSK đã ký số lên Cổng Quốc gia (Mã giao dịch: {portal_msg_id}) -> Kết quả: {new_sync_status}",
            "SUCCESS" if is_ok else "FAILED",
            client_ip,
        )

        return {
            "success": is_ok,
            "package_id": package_id,
            "portal_msg_id": portal_msg_id,
            "pushed_count": len(rows) if is_ok else 0,
            "failed_count": 0 if is_ok else len(rows),
            "is_simulation": push_res.get("is_simulation", False),
            "message": push_res.get("message") or push_res.get("error"),
            "portal_response": push_res.get("data"),
            "envelope_preview": {
                "header": envelope["header"],
                "checksum": envelope["checksum"],
                "signature_preview": envelope["signature"][:64] + "...",
            },
        }
    finally:
        conn.close()


# ==================== LOGS & HISTORY ENDPOINTS ====================
@app.get("/api/push-logs")
def get_push_logs(limit: int = 50, current_user: dict = Depends(get_current_user)):
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM portal_push_logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return {"success": True, "data": [dict(r) for r in rows]}
    finally:
        conn.close()


@app.get("/api/audit-logs")
def get_audit_logs_endpoint(limit: int = 100, current_user: dict = Depends(get_current_user)):
    conn = get_conn()
    try:
        rows = conn.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return {"success": True, "data": [dict(r) for r in rows]}
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    from server.core.config import DB_PATH

    init_database()
    ensure_sample_files_on_disk()
    _seed_initial_demo_batch_if_empty()

    cfg = get_all_configs()
    hosp_name = cfg.get("hospital", {}).get("ten_benh_vien", "Bệnh viện Đa khoa Bình An")
    ma_cskcb = cfg.get("hospital", {}).get("ma_cskcb", "91034")
    port = int(os.getenv("PORT", "8790"))

    print("=" * 66)
    print(f"  Port: {port} | Co so KCB: {hosp_name} ({ma_cskcb})")
    print(f"  Local Database: SQLite WAL ({DB_PATH})")
    print("  Kiem tra 4 lop & Ky so USB Token Client: HOAT DONG")
    print("  Tai khoan: admin | Mat khau: admin123")
    print("  Che do tu dong cap nhat (Hot Reload): BAT")
    print("=" * 66)
    try:
        uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True, log_level="info")
    except KeyboardInterrupt:
        pass
    finally:
        os._exit(0)
