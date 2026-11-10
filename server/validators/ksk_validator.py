"""
Bộ máy kiểm tra toàn diện hồ sơ Khám Sức Khỏe Quốc Gia (Pre-check Validation Engine)
Kiểm tra 4 lớp bắt buộc trước khi mở khóa Ký số điện tử Bệnh viện:
1. Thông tin hành chính & Định danh công dân (CCCD 12 số / CMND 9 số - Đề án 06)
2. Thể lực, Sinh hiệu & Xét nghiệm bắt buộc (Huyết áp, Chiều cao, Cân nặng, Ma túy/Cồn với Lái xe)
3. Khám lâm sàng các chuyên khoa & Cận lâm sàng
4. Phân loại sức khỏe, Bác sĩ kết luận, CCHN, Chữ ký chuyên khoa & Chữ ký kết luận
"""

import re
import datetime
from typing import Dict, Any, List, Optional

VALID_PROVINCE_CODES = {
    f"{i:03d}"
    for i in [
        1, 2, 4, 6, 8, 10, 11, 12, 14, 15, 17, 19, 20, 22, 24, 25, 26, 27, 30, 31, 33, 34, 35, 36, 37, 38,
        40, 42, 44, 45, 46, 48, 49, 51, 52, 54, 56, 58, 60, 62, 64, 66, 67, 68, 70, 72, 74, 75, 77, 79,
        80, 82, 83, 84, 86, 87, 89, 91, 92, 93, 94, 95, 96,
    ]
}

VALID_CONCLUSIONS = {
    "LOAI_I", "LOAI_II", "LOAI_III", "LOAI_IV", "LOAI_V",
    "LOẠI I", "LOẠI II", "LOẠI III", "LOẠI IV", "LOẠI V",
    "LOAI 1", "LOAI 2", "LOAI 3", "LOAI 4", "LOAI 5",
    "1", "2", "3", "4", "5",
    "DAT", "KHONG_DAT", "DU_DIEU_KIEN", "KHONG_DU_DIEU_KIEN",
    "ĐỦ ĐIỀU KIỆN", "ĐỦ ĐK LÁI XE", "ĐỦ ĐIỀU KIỆN LÁI XE", "KHÔNG ĐỦ ĐK",
}

UNSIGNED_KEYWORDS = {
    "", "0", "false", "no", "none", "null", "chưa ký", "chua ky",
    "thiếu", "thieu", "chưa", "chua", "pending", "unsigned", "không", "khong",
}


def clean_str(val: Any) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    return "" if s.lower() in ("none", "null", "nan", "dbnull") else s


def parse_float(val: Any) -> Optional[float]:
    s = clean_str(val).replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def parse_int(val: Any) -> Optional[int]:
    f = parse_float(val)
    if f is None:
        return None
    try:
        return int(round(f))
    except (ValueError, TypeError):
        return None


def is_signed_value(val: Any) -> bool:
    s = clean_str(val).lower()
    if not s:
        return False
    if s in UNSIGNED_KEYWORDS or s.startswith("chưa") or s.startswith("chua") or s.startswith("thiếu") or s.startswith("thieu"):
        return False
    return True


def normalize_conclusion_code(raw_val: str, loai_ksk: str = "DINH_KY") -> str:
    s = clean_str(raw_val).upper()
    mapping = {
        "1": "LOAI_I", "LOAI 1": "LOAI_I", "LOẠI 1": "LOAI_I", "LOẠI I": "LOAI_I", "LOAI_I": "LOAI_I",
        "2": "LOAI_II", "LOAI 2": "LOAI_II", "LOẠI 2": "LOAI_II", "LOẠI II": "LOAI_II", "LOAI_II": "LOAI_II",
        "3": "LOAI_III", "LOAI 3": "LOAI_III", "LOẠI 3": "LOAI_III", "LOẠI III": "LOAI_III", "LOAI_III": "LOAI_III",
        "4": "LOAI_IV", "LOAI 4": "LOAI_IV", "LOẠI 4": "LOAI_IV", "LOẠI IV": "LOAI_IV", "LOAI_IV": "LOAI_IV",
        "5": "LOAI_V", "LOAI 5": "LOAI_V", "LOẠI 5": "LOAI_V", "LOẠI V": "LOAI_V", "LOAI_V": "LOAI_V",
    }
    if s in mapping:
        return mapping[s]
    if "ĐỦ" in s or "DU_DIEU_KIEN" in s or s == "DAT":
        return "DU_DIEU_KIEN" if loai_ksk == "LAI_XE" else "LOAI_I"
    return s


def validate_ksk_record(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Kiểm tra đầy đủ tất cả các trường bắt buộc, chữ ký chuyên khoa và chữ ký kết luận của 1 hồ sơ KSK.
    Trả về chi tiết lỗi (ERROR - chặn ký số) và cảnh báo (WARNING).
    """
    issues: List[Dict[str, Any]] = []

    ma_kcb = clean_str(record.get("ma_kcb"))
    ma_bn = clean_str(record.get("ma_benh_nhan"))
    ho_va_ten = clean_str(record.get("ho_va_ten"))
    so_cccd = clean_str(record.get("so_cccd"))
    ngay_sinh = clean_str(record.get("ngay_sinh"))
    gioi_tinh = clean_str(record.get("gioi_tinh"))
    dia_chi = clean_str(record.get("dia_chi"))
    ngay_kham = clean_str(record.get("ngay_kham"))
    loai_ksk = clean_str(record.get("loai_ksk") or "DINH_KY").upper()
    if "LAI" in loai_ksk or "GPLX" in loai_ksk or "LÁI" in loai_ksk:
        loai_ksk = "LAI_XE"
    else:
        loai_ksk = "DINH_KY"

    is_female = gioi_tinh.lower() in ("nữ", "nu", "2", "f", "female")

    # ==================== 1. THÔNG TIN HÀNH CHÍNH & ĐỊNH DANH ====================
    if not ma_kcb:
        issues.append({
            "severity": "ERROR",
            "category": "PATIENT_INFO",
            "field": "ma_kcb",
            "field_label": "Mã KCB / Số hồ sơ",
            "current_value": ma_kcb,
            "error_code": "ERR_MISSING_MAKCB",
            "message": "Thiếu Mã KCB (Mã hồ sơ khám)",
            "suggestion": "Nhập mã KCB duy nhất cho hồ sơ khám sức khỏe",
        })

    if not ho_va_ten or len(ho_va_ten) < 3:
        issues.append({
            "severity": "ERROR",
            "category": "PATIENT_INFO",
            "field": "ho_va_ten",
            "field_label": "Họ và tên",
            "current_value": ho_va_ten,
            "error_code": "ERR_MISSING_NAME",
            "message": "Thiếu Họ và tên bệnh nhân (hoặc quá ngắn)",
            "suggestion": "Nhập đầy đủ họ và tên có dấu theo thẻ CCCD",
        })

    clean_cccd = re.sub(r"[\s\.\-]", "", so_cccd)
    if not clean_cccd:
        issues.append({
            "severity": "ERROR",
            "category": "PATIENT_INFO",
            "field": "so_cccd",
            "field_label": "Số CCCD / CMND",
            "current_value": so_cccd,
            "error_code": "ERR_MISSING_CCCD",
            "message": "Thiếu số CCCD/CMND (Bắt buộc theo Đề án 06 để định danh VNeID)",
            "suggestion": "Nhập đúng 12 chữ số CCCD gắn chip hoặc 9 chữ số CMND",
        })
    elif not clean_cccd.isdigit():
        issues.append({
            "severity": "ERROR",
            "category": "PATIENT_INFO",
            "field": "so_cccd",
            "field_label": "Số CCCD / CMND",
            "current_value": so_cccd,
            "error_code": "ERR_CCCD_NON_DIGIT",
            "message": "Số CCCD/CMND chỉ được phép chứa chữ số",
            "suggestion": "Xóa các ký tự chữ hoặc ký tự đặc biệt trong số CCCD",
        })
    elif len(clean_cccd) not in (9, 12):
        issues.append({
            "severity": "ERROR",
            "category": "PATIENT_INFO",
            "field": "so_cccd",
            "field_label": "Số CCCD / CMND",
            "current_value": so_cccd,
            "error_code": "ERR_CCCD_LENGTH",
            "message": f"Số CCCD/CMND đang có {len(clean_cccd)} số (Yêu cầu chuẩn 12 số CCCD hoặc 9 số CMND)",
            "suggestion": "Kiểm tra và nhập đủ 12 chữ số CCCD",
        })
    elif len(clean_cccd) == 12 and clean_cccd[:3] not in VALID_PROVINCE_CODES:
        issues.append({
            "severity": "WARNING",
            "category": "PATIENT_INFO",
            "field": "so_cccd",
            "field_label": "Số CCCD",
            "current_value": so_cccd,
            "error_code": "WARN_CCCD_PROVINCE",
            "message": f"3 số đầu CCCD ({clean_cccd[:3]}) không nằm trong danh mục mã tỉnh/thành phố chuẩn",
            "suggestion": "Đối chiếu lại số CCCD trên thẻ của người khám",
        })

    birth_year = None
    if not ngay_sinh:
        issues.append({
            "severity": "ERROR",
            "category": "PATIENT_INFO",
            "field": "ngay_sinh",
            "field_label": "Ngày sinh",
            "current_value": ngay_sinh,
            "error_code": "ERR_MISSING_DOB",
            "message": "Thiếu thông tin Ngày sinh",
            "suggestion": "Nhập ngày sinh định dạng YYYY-MM-DD hoặc DD/MM/YYYY",
        })
    else:
        m = re.search(r"(\d{4})", ngay_sinh)
        cur_year = datetime.datetime.now().year
        if not m:
            issues.append({
                "severity": "ERROR",
                "category": "PATIENT_INFO",
                "field": "ngay_sinh",
                "field_label": "Ngày sinh",
                "current_value": ngay_sinh,
                "error_code": "ERR_INVALID_DOB",
                "message": "Ngày sinh không hợp lệ (không tìm thấy năm sinh 4 chữ số)",
                "suggestion": "Nhập ngày sinh theo dạng YYYY-MM-DD (ví dụ: 1992-05-15)",
            })
        else:
            birth_year = int(m.group(1))
            if birth_year < 1900 or birth_year > cur_year:
                issues.append({
                    "severity": "ERROR",
                    "category": "PATIENT_INFO",
                    "field": "ngay_sinh",
                    "field_label": "Ngày sinh",
                    "current_value": ngay_sinh,
                    "error_code": "ERR_DOB_OUT_OF_RANGE",
                    "message": f"Năm sinh {birth_year} không hợp lý",
                    "suggestion": "Kiểm tra lại năm sinh thực tế",
                })

    if not gioi_tinh or gioi_tinh.lower() not in ("nam", "nữ", "nu", "1", "2"):
        issues.append({
            "severity": "ERROR",
            "category": "PATIENT_INFO",
            "field": "gioi_tinh",
            "field_label": "Giới tính",
            "current_value": gioi_tinh,
            "error_code": "ERR_MISSING_GENDER",
            "message": "Thiếu hoặc sai thông tin Giới tính",
            "suggestion": "Nhập 'Nam' hoặc 'Nữ'",
        })

    if not dia_chi:
        issues.append({
            "severity": "ERROR",
            "category": "PATIENT_INFO",
            "field": "dia_chi",
            "field_label": "Địa chỉ",
            "current_value": dia_chi,
            "error_code": "ERR_MISSING_ADDRESS",
            "message": "Thiếu địa chỉ cư trú của người khám",
            "suggestion": "Bổ sung địa chỉ xã/phường, tỉnh/thành phố",
        })

    if not ngay_kham:
        issues.append({
            "severity": "ERROR",
            "category": "PATIENT_INFO",
            "field": "ngay_kham",
            "field_label": "Ngày khám",
            "current_value": ngay_kham,
            "error_code": "ERR_MISSING_EXAM_DATE",
            "message": "Thiếu ngày khám sức khỏe",
            "suggestion": "Nhập ngày khám (ví dụ: 2026-11-10)",
        })

    # ==================== 2. THỂ LỰC & SINH HIỆU ====================
    chieu_cao = parse_float(record.get("chieu_cao"))
    can_nang = parse_float(record.get("can_nang"))
    mach = parse_int(record.get("mach"))
    huyet_ap = clean_str(record.get("huyet_ap"))

    if loai_ksk == "DINH_KY":
        if chieu_cao is None or chieu_cao <= 0:
            issues.append({
                "severity": "ERROR",
                "category": "VITAL_SIGNS",
                "field": "chieu_cao",
                "field_label": "Chiều cao (cm)",
                "current_value": clean_str(record.get("chieu_cao")),
                "error_code": "ERR_MISSING_HEIGHT",
                "message": "Thiếu chỉ số Chiều cao (cm)",
                "suggestion": "Nhập chiều cao tính bằng cm (ví dụ: 165)",
            })
        elif chieu_cao < 90 or chieu_cao > 230:
            issues.append({
                "severity": "WARNING",
                "category": "VITAL_SIGNS",
                "field": "chieu_cao",
                "field_label": "Chiều cao (cm)",
                "current_value": str(chieu_cao),
                "error_code": "WARN_HEIGHT_RANGE",
                "message": f"Chiều cao {chieu_cao} cm nằm ngoài ngưỡng thông thường (90-230 cm)",
                "suggestion": "Kiểm tra lại đơn vị chiều cao (cm)",
            })

        if can_nang is None or can_nang <= 0:
            issues.append({
                "severity": "ERROR",
                "category": "VITAL_SIGNS",
                "field": "can_nang",
                "field_label": "Cân nặng (kg)",
                "current_value": clean_str(record.get("can_nang")),
                "error_code": "ERR_MISSING_WEIGHT",
                "message": "Thiếu chỉ số Cân nặng (kg)",
                "suggestion": "Nhập cân nặng tính bằng kg (ví dụ: 60)",
            })

    if mach is None or mach <= 0:
        issues.append({
            "severity": "ERROR",
            "category": "VITAL_SIGNS",
            "field": "mach",
            "field_label": "Mạch (lần/phút)",
            "current_value": clean_str(record.get("mach")),
            "error_code": "ERR_MISSING_PULSE",
            "message": "Thiếu chỉ số Mạch (lần/phút)",
            "suggestion": "Nhập tần số mạch (ví dụ: 75)",
        })

    if not huyet_ap:
        issues.append({
            "severity": "ERROR",
            "category": "VITAL_SIGNS",
            "field": "huyet_ap",
            "field_label": "Huyết áp (mmHg)",
            "current_value": huyet_ap,
            "error_code": "ERR_MISSING_BP",
            "message": "Thiếu chỉ số Huyết áp",
            "suggestion": "Nhập huyết áp định dạng TâmThu/TâmTrương (ví dụ: 120/80)",
        })
    else:
        bp_clean = huyet_ap.replace("-", "/").replace(" ", "")
        parts = bp_clean.split("/")
        if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
            issues.append({
                "severity": "ERROR",
                "category": "VITAL_SIGNS",
                "field": "huyet_ap",
                "field_label": "Huyết áp (mmHg)",
                "current_value": huyet_ap,
                "error_code": "ERR_BP_FORMAT",
                "message": f"Huyết áp '{huyet_ap}' sai định dạng (Yêu cầu dạng 120/80)",
                "suggestion": "Sửa lại thành TâmThu/TâmTrương (ví dụ: 120/80)",
            })
        elif int(parts[0]) <= int(parts[1]):
            issues.append({
                "severity": "ERROR",
                "category": "VITAL_SIGNS",
                "field": "huyet_ap",
                "field_label": "Huyết áp (mmHg)",
                "current_value": huyet_ap,
                "error_code": "ERR_BP_LOGIC",
                "message": f"Huyết áp tâm thu ({parts[0]}) phải lớn hơn tâm trương ({parts[1]})",
                "suggestion": "Kiểm tra và nhập lại huyết áp đúng",
            })

    # ==================== 3. CHUYÊN KHOA LÂM SÀNG & CẬN LÂM SÀNG ====================
    if loai_ksk == "DINH_KY":
        required_clinical = [
            ("kham_noi_khoa", "Khám Nội khoa"),
            ("kham_ngoai_khoa", "Khám Ngoại khoa"),
            ("kham_da_lieu", "Khám Da liễu"),
            ("kham_mat", "Khám Mắt"),
            ("kham_tmh", "Khám Tai - Mũi - Họng"),
            ("kham_rhm", "Khám Răng - Hàm - Mặt"),
        ]
        if is_female:
            required_clinical.append(("kham_san_phu_khoa", "Khám Sản phụ khoa (Nữ)"))

        for field_key, field_label in required_clinical:
            val = clean_str(record.get(field_key))
            if not val:
                issues.append({
                    "severity": "ERROR",
                    "category": "CLINICAL_EXAMS",
                    "field": field_key,
                    "field_label": field_label,
                    "current_value": val,
                    "error_code": f"ERR_MISSING_{field_key.upper()}",
                    "message": f"Thiếu kết quả {field_label}",
                    "suggestion": f"Bổ sung kết quả khám {field_label} (ví dụ: 'Bình thường')",
                })

        required_paraclinical = [
            ("x_quang_phoi", "Kết quả X-Quang phổi"),
            ("cong_thuc_mau", "Xét nghiệm Công thức máu"),
            ("xet_nghiem_nuoc_tieu", "Xét nghiệm Nước tiểu"),
        ]
        for field_key, field_label in required_paraclinical:
            val = clean_str(record.get(field_key))
            if not val:
                issues.append({
                    "severity": "ERROR",
                    "category": "PARACLINICAL",
                    "field": field_key,
                    "field_label": field_label,
                    "current_value": val,
                    "error_code": f"ERR_MISSING_{field_key.upper()}",
                    "message": f"Thiếu kết quả cận lâm sàng: {field_label}",
                    "suggestion": f"Nhập kết quả {field_label} (ví dụ: 'Bình thường')",
                })
    else:
        # KSK Lái xe (TT 36/2024/TT-BYT)
        hang_xe = clean_str(record.get("hang_bang_lai"))
        test_ma_tuy = clean_str(record.get("test_ma_tuy"))
        nong_do_con = clean_str(record.get("nong_do_con"))

        if not hang_bang_lai_valid(hang_xe):
            issues.append({
                "severity": "ERROR",
                "category": "DRIVING_EXAM",
                "field": "hang_bang_lai",
                "field_label": "Hạng bằng lái xe",
                "current_value": hang_xe,
                "error_code": "ERR_MISSING_LICENSE_CLASS",
                "message": "KSK Lái xe bắt buộc phải có Hạng bằng lái (A1, A, B, C1, C, D...)",
                "suggestion": "Nhập hạng giấy phép lái xe (ví dụ: B, C1, A1)",
            })
        if not test_ma_tuy:
            issues.append({
                "severity": "ERROR",
                "category": "DRIVING_EXAM",
                "field": "test_ma_tuy",
                "field_label": "Test Ma túy (4-5 chất)",
                "current_value": test_ma_tuy,
                "error_code": "ERR_MISSING_DRUG_TEST",
                "message": "Thiếu kết quả xét nghiệm Ma túy (Bắt buộc đối với KSK Lái xe)",
                "suggestion": "Nhập kết quả xét nghiệm ma túy (ví dụ: 'Âm tính')",
            })
        elif "dương" in test_ma_tuy.lower() or "duong" in test_ma_tuy.lower() or "positive" in test_ma_tuy.lower():
            issues.append({
                "severity": "ERROR",
                "category": "DRIVING_EXAM",
                "field": "test_ma_tuy",
                "field_label": "Test Ma túy",
                "current_value": test_ma_tuy,
                "error_code": "ERR_POSITIVE_DRUG_TEST",
                "message": "Kết quả Ma túy DƯƠNG TÍNH - Không đủ điều kiện đẩy cổng cấp/đổi GPLX",
                "suggestion": "Kiểm tra lại kết quả xét nghiệm ma túy",
            })
        if not nong_do_con:
            issues.append({
                "severity": "ERROR",
                "category": "DRIVING_EXAM",
                "field": "nong_do_con",
                "field_label": "Nồng độ cồn",
                "current_value": nong_do_con,
                "error_code": "ERR_MISSING_ALCOHOL_TEST",
                "message": "Thiếu kết quả đo Nồng độ cồn (Bắt buộc đối với KSK Lái xe)",
                "suggestion": "Nhập kết quả nồng độ cồn (ví dụ: '0 mg/L' hoặc 'Âm tính')",
            })

    # ==================== 4. KẾT LUẬN, CHỮ KÝ CHUYÊN KHOA & CHỮ KÝ KẾT LUẬN ====================
    phan_loai = clean_str(record.get("phan_loai_sk"))
    bs_ket_luan = clean_str(record.get("bs_ket_luan"))
    cchn_bs = clean_str(record.get("cchn_bs_ket_luan"))
    chuky_ket_luan = clean_str(record.get("chuky_ket_luan"))
    chuky_chuyen_khoa = clean_str(record.get("chuky_chuyen_khoa"))

    if not phan_loai:
        issues.append({
            "severity": "ERROR",
            "category": "SIGNATURES_CONCLUSION",
            "field": "phan_loai_sk",
            "field_label": "Phân loại sức khỏe",
            "current_value": phan_loai,
            "error_code": "ERR_MISSING_CONCLUSION",
            "message": "Chưa có Kết luận Phân loại sức khỏe",
            "suggestion": "Nhập LOAI_I, LOAI_II, LOAI_III, LOAI_IV, LOAI_V (hoặc Đủ điều kiện)",
        })
    elif phan_loai.upper() not in VALID_CONCLUSIONS and not phan_loai.upper().startswith("LOAI_"):
        issues.append({
            "severity": "ERROR",
            "category": "SIGNATURES_CONCLUSION",
            "field": "phan_loai_sk",
            "field_label": "Phân loại sức khỏe",
            "current_value": phan_loai,
            "error_code": "ERR_INVALID_CONCLUSION",
            "message": f"Phân loại sức khỏe '{phan_loai}' không đúng chuẩn Bộ Y Tế",
            "suggestion": "Chọn LOAI_I, LOAI_II, LOAI_III, LOAI_IV hoặc LOAI_V",
        })

    if not bs_ket_luan:
        issues.append({
            "severity": "ERROR",
            "category": "SIGNATURES_CONCLUSION",
            "field": "bs_ket_luan",
            "field_label": "Bác sĩ Kết luận",
            "current_value": bs_ket_luan,
            "error_code": "ERR_MISSING_DOCTOR_NAME",
            "message": "Thiếu Họ tên / Mã Bác sĩ Kết luận",
            "suggestion": "Nhập họ tên bác sĩ kết luận (ví dụ: 'BS.CKI Nguyễn Văn A')",
        })

    if not cchn_bs:
        issues.append({
            "severity": "ERROR",
            "category": "SIGNATURES_CONCLUSION",
            "field": "cchn_bs_ket_luan",
            "field_label": "Số CCHN Bác sĩ Kết luận",
            "current_value": cchn_bs,
            "error_code": "ERR_MISSING_DOCTOR_CCHN",
            "message": "Thiếu Số Chứng chỉ hành nghề (CCHN) của Bác sĩ Kết luận",
            "suggestion": "Nhập số CCHN của bác sĩ kết luận (ví dụ: '001234/KG-CCHN')",
        })

    has_conclusion_sig = is_signed_value(chuky_ket_luan)
    if not has_conclusion_sig:
        issues.append({
            "severity": "ERROR",
            "category": "SIGNATURES_CONCLUSION",
            "field": "chuky_ket_luan",
            "field_label": "Chữ ký Bác sĩ Kết luận",
            "current_value": chuky_ket_luan or "Chưa ký",
            "error_code": "ERR_MISSING_CONCLUSION_SIGNATURE",
            "message": "Hồ sơ CHƯA CÓ Chữ ký Kết luận của Bác sĩ",
            "suggestion": "Xác nhận chữ ký kết luận ('Đã ký') sau khi bác sĩ kết luận đã ký duyệt",
        })

    has_specialty_sig = is_signed_value(chuky_chuyen_khoa)
    if not has_specialty_sig:
        issues.append({
            "severity": "ERROR",
            "category": "SIGNATURES_CONCLUSION",
            "field": "chuky_chuyen_khoa",
            "field_label": "Chữ ký các Bác sĩ Chuyên khoa",
            "current_value": chuky_chuyen_khoa or "Chưa ký đủ",
            "error_code": "ERR_MISSING_SPECIALTY_SIGNATURE",
            "message": "Hồ sơ CHƯA ĐỦ Chữ ký số của các Bác sĩ Chuyên khoa lâm sàng",
            "suggestion": "Đảm bảo tất cả các khoa đã ký đủ ('Đã ký đủ') trước khi ký số Bệnh viện",
        })

    errors = [i for i in issues if i["severity"] == "ERROR"]
    warnings = [i for i in issues if i["severity"] == "WARNING"]

    return {
        "ma_kcb": ma_kcb,
        "ho_va_ten": ho_va_ten,
        "so_cccd": so_cccd,
        "loai_ksk": loai_ksk,
        "is_eligible": len(errors) == 0,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "has_conclusion_signature": has_conclusion_sig,
        "has_specialty_signatures": has_specialty_sig,
        "missing_fields": [e["field_label"] for e in errors],
        "issues": issues,
    }


def hang_bang_lai_valid(val: str) -> bool:
    return bool(clean_str(val))
