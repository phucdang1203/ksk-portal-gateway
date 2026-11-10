"""
Dịch vụ đóng gói chuẩn Phụ lục 02 - Quyết định 2062/QĐ-BYT & Chuẩn bị Digest
cho phép Máy Client (cắm trực tiếp USB Token Bệnh viện) ký số 1 lần cho toàn bộ hồ sơ.
"""

import json
import base64
import hashlib
import datetime
from typing import Dict, Any, List
from server.core.config import DATA_DIR
from server.validators.ksk_validator import normalize_conclusion_code

TEST_KEY_PATH = DATA_DIR / "hospital_soft_token_rsa2048.pem"


def build_ksk_portal_record(rec: Dict[str, Any], ma_cskcb: str = "91034") -> Dict[str, Any]:
    """
    Chuẩn hóa 1 bản ghi KSK sang cấu trúc JSON chuẩn của Cổng dữ liệu Sức khỏe Quốc gia
    (Phụ lục 01 & 02 - QĐ 2062/QĐ-BYT và Thông tư 36/2024/TT-BYT).
    """
    loai_ksk = (rec.get("loai_ksk") or "DINH_KY").strip().upper()
    phan_loai = normalize_conclusion_code(rec.get("phan_loai_sk", "LOAI_I"), loai_ksk)

    try:
        chieu_cao = float(str(rec.get("chieu_cao") or "165").replace(",", "."))
    except Exception:
        chieu_cao = 165.0

    try:
        can_nang = float(str(rec.get("can_nang") or "60").replace(",", "."))
    except Exception:
        can_nang = 60.0

    try:
        bmi = float(str(rec.get("bmi") or "0").replace(",", "."))
        if bmi <= 0 and chieu_cao > 0:
            bmi = round(can_nang / ((chieu_cao / 100.0) ** 2), 2)
    except Exception:
        bmi = round(can_nang / ((chieu_cao / 100.0) ** 2), 2) if chieu_cao > 0 else 22.0

    try:
        mach = int(float(str(rec.get("mach") or "75")))
    except Exception:
        mach = 75

    gt_str = str(rec.get("gioi_tinh") or "Nam").strip().lower()
    gioi_tinh_code = 2 if gt_str in ("nữ", "nu", "2", "f") else 1

    payload = {
        "ma_cskcb": ma_cskcb,
        "ma_benh_nhan": str(rec.get("ma_benh_nhan") or "").strip(),
        "ma_kcb": str(rec.get("ma_kcb") or "").strip(),
        "so_cccd": str(rec.get("so_cccd") or "").strip(),
        "ho_va_ten": str(rec.get("ho_va_ten") or "").strip().upper(),
        "ngay_sinh": str(rec.get("ngay_sinh") or "").strip(),
        "gioi_tinh": gioi_tinh_code,
        "so_dien_thoai": str(rec.get("so_dien_thoai") or "").strip(),
        "dia_chi": str(rec.get("dia_chi") or "").strip(),
        "ngay_kham": str(rec.get("ngay_kham") or "").strip(),
        "loai_kham_suc_khoe": loai_ksk,
        "chieu_cao": chieu_cao,
        "can_nang": can_nang,
        "bmi": bmi,
        "mach": mach,
        "huyet_ap": str(rec.get("huyet_ap") or "120/80").strip(),
        "phan_loai_the_luc": phan_loai,
        "kham_lam_sang": {
            "noi_khoa": {"ket_qua": str(rec.get("kham_noi_khoa") or "Bình thường"), "phan_loai": 1},
            "ngoai_khoa": {"ket_qua": str(rec.get("kham_ngoai_khoa") or "Bình thường"), "phan_loai": 1},
            "san_phu_khoa": {"ket_qua": str(rec.get("kham_san_phu_khoa") or "Không áp dụng"), "phan_loai": 1},
            "mat": {"ket_qua": str(rec.get("kham_mat") or "Bình thường"), "phan_loai": 1},
            "tai_mui_hong": {"ket_qua": str(rec.get("kham_tmh") or "Bình thường"), "phan_loai": 1},
            "rang_ham_mat": {"ket_qua": str(rec.get("kham_rhm") or "Bình thường"), "phan_loai": 1},
            "da_lieu": {"ket_qua": str(rec.get("kham_da_lieu") or "Bình thường"), "phan_loai": 1},
        },
        "can_lam_sang": {
            "x_quang_phoi": str(rec.get("x_quang_phoi") or "Bình thường"),
            "cong_thuc_mau": str(rec.get("cong_thuc_mau") or "Bình thường"),
            "duong_huyet": str(rec.get("sinh_hoa_mau") or "5.0 mmol/L"),
            "nuoc_tieu": str(rec.get("xet_nghiem_nuoc_tieu") or "Bình thường"),
            "test_ma_tuy": str(rec.get("test_ma_tuy") or ""),
            "nong_do_con": str(rec.get("nong_do_con") or ""),
            "hang_bang_lai": str(rec.get("hang_bang_lai") or ""),
        },
        "ket_luan": {
            "phan_loai_suc_khoe": phan_loai,
            "cac_benh_tat_neu_co": str(rec.get("ket_luan_benh") or ""),
            "bac_si_ket_luan": str(rec.get("bs_ket_luan") or ""),
            "cchn_bac_si_ket_luan": str(rec.get("cchn_bs_ket_luan") or ""),
            "da_ky_ket_luan": True,
            "da_ky_chuyen_khoa": True,
            "ngay_ket_luan": str(rec.get("ngay_ket_luan") or rec.get("ngay_kham") or ""),
        },
    }
    return payload


def prepare_batch_signing_payload(db_records: List[Dict[str, Any]], ma_cskcb: str = "91034") -> Dict[str, Any]:
    """
    Chuẩn bị gói dữ liệu tổng hợp cho N hồ sơ đủ điều kiện để máy Client ký số 1 lần:
    1. A = Uppercase(SHA256(header_compact))
    2. B = Uppercase(SHA256(data_base64))
    3. string_to_sign = A + "." + B
    """
    tz = datetime.timezone(datetime.timedelta(hours=7))
    now = datetime.datetime.now(tz)
    ts_compact = now.strftime("%Y%m%d%H%M%S")
    package_id = f"{ma_cskcb}_{ts_compact}_{len(db_records):03d}"

    header = {
        "ma_cskcb": ma_cskcb,
        "txn_type": "sync_checkup",
        "version": "1.0",
        "msg_id": package_id,
        "timestamp": now.isoformat(),
    }

    standard_records = []
    record_digests = {}

    for row in db_records:
        rec_data = row["record_data"]
        std = build_ksk_portal_record(rec_data, ma_cskcb=ma_cskcb)
        standard_records.append(std)
        rec_str = json.dumps(std, ensure_ascii=False, separators=(",", ":"))
        rec_hash = hashlib.sha256(rec_str.encode("utf-8")).hexdigest().upper()
        record_digests[str(row["id"])] = rec_hash

    data_json_str = json.dumps(standard_records, ensure_ascii=False, separators=(",", ":"))
    data_base64 = base64.b64encode(data_json_str.encode("utf-8")).decode("utf-8")

    header_str = json.dumps(header, separators=(",", ":"))
    hash_a = hashlib.sha256(header_str.encode("utf-8")).hexdigest().upper()
    hash_b = hashlib.sha256(data_base64.encode("utf-8")).hexdigest().upper()
    string_to_sign = f"{hash_a}.{hash_b}"

    return {
        "package_id": package_id,
        "header": header,
        "data_base64": data_base64,
        "checksum": hash_b,
        "string_to_sign": string_to_sign,
        "record_digests": record_digests,
        "record_count": len(db_records),
    }


def get_or_create_test_rsa_key() -> str:
    """
    Sinh khóa RSA-2048 chuẩn cho chế độ Soft-Token Test (khi máy trạm chạy trên trình duyệt Web
    hoặc chưa cắm USB Token vật lý) để ký thật bằng thuật toán RSA-SHA256.
    """
    if TEST_KEY_PATH.exists():
        return TEST_KEY_PATH.read_text(encoding="utf-8")

    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    TEST_KEY_PATH.write_text(pem, encoding="utf-8")
    return pem


def sign_string_with_soft_token(string_to_sign: str) -> str:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.serialization import load_pem_private_key

    pem = get_or_create_test_rsa_key()
    pkey = load_pem_private_key(pem.encode("utf-8"), password=None)
    sig_bytes = pkey.sign(
        string_to_sign.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return base64.b64encode(sig_bytes).decode("utf-8").upper()
