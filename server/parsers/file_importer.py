"""
Bộ đọc và chuẩn hóa dữ liệu Import từ CSV (.csv) và Excel (.xlsx, .xls)
Chỉ hỗ trợ duy nhất 2 định dạng CSV và Excel theo yêu cầu hệ thống.
"""

import io
import csv
import re
import unicodedata
import datetime
from typing import List, Dict, Any, Tuple
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from server.core.config import SAMPLES_DIR


def remove_accents(text: str) -> str:
    if not text:
        return ""
    text = text.replace("đ", "d").replace("Đ", "D")
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join([c for c in nfkd if not unicodedata.combining(c)])


def normalize_header_key(raw_header: Any) -> str:
    if raw_header is None:
        return ""
    s = remove_accents(str(raw_header).strip().lower())
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


# Bảng ánh xạ từ các tên cột CSV/Excel khác nhau về tên trường chuẩn của hệ thống
HEADER_ALIASES: Dict[str, List[str]] = {
    "ma_kcb": ["ma_kcb", "makcb", "ma_ho_so", "mahoso", "so_phieu", "sophieu", "so_giay_ksk", "ma_luot_kham"],
    "ma_benh_nhan": ["ma_benh_nhan", "mabn", "ma_bn", "ma_y_te", "patient_id"],
    "ho_va_ten": ["ho_va_ten", "hoten", "ho_ten", "ten_benh_nhan", "tenbn", "ho_va_ten_benh_nhan", "full_name"],
    "so_cccd": ["so_cccd", "socmnd", "cccd", "cmnd", "so_cmnd", "so_cccd_cmnd", "so_dinh_danh", "ma_dinh_danh"],
    "ngay_sinh": ["ngay_sinh", "ngaysinh", "nam_sinh", "namsinh", "dob", "birth_date"],
    "gioi_tinh": ["gioi_tinh", "gioitinh", "phai", "sex", "gender"],
    "so_dien_thoai": ["so_dien_thoai", "dienthoai", "sdt", "so_dt", "phone", "mobile"],
    "dia_chi": ["dia_chi", "diachi", "noi_o", "dia_chi_thuong_tru", "address"],
    "ngay_kham": ["ngay_kham", "ngaydk", "ngay_dang_ky", "ngay_ksk", "exam_date"],
    "loai_ksk": ["loai_ksk", "loai_kham_suc_khoe", "loai_kham", "phan_loai_ksk", "exam_type"],
    "chieu_cao": ["chieu_cao", "chieu_cao_cm", "chieucao", "height"],
    "can_nang": ["can_nang", "can_nang_kg", "cannang", "weight"],
    "bmi": ["bmi", "chi_so_bmi"],
    "mach": ["mach", "mach_lan_phut", "tan_so_mach", "pulse"],
    "huyet_ap": ["huyet_ap", "huyetap", "huyet_ap_mmhg", "ha", "blood_pressure"],
    "kham_noi_khoa": ["kham_noi_khoa", "noi_khoa", "noikhoa", "tuan_hoan", "kham_tuan_hoan", "noi_tong_quat"],
    "kham_ngoai_khoa": ["kham_ngoai_khoa", "ngoai_khoa", "ngoaikhoa", "ngoai_tong_quat"],
    "kham_san_phu_khoa": ["kham_san_phu_khoa", "san_phu_khoa", "sanphukhoa", "kham_san", "phu_khoa"],
    "kham_mat": ["kham_mat", "mat", "mat_benh", "chuyen_khoa_mat"],
    "kham_tmh": ["kham_tmh", "tai_mui_hong", "tmh", "tmh_benh", "kham_tai_mui_hong"],
    "kham_rhm": ["kham_rhm", "rang_ham_mat", "rhm", "rhm_benh", "kham_rang_ham_mat"],
    "kham_da_lieu": ["kham_da_lieu", "da_lieu", "dalieu"],
    "x_quang_phoi": ["x_quang_phoi", "ket_qua_xquang", "cdha", "xquang", "x_quang", "chan_doan_hinh_anh"],
    "cong_thuc_mau": ["cong_thuc_mau", "huyet_hoc", "xet_nghiem_mau", "ctm"],
    "sinh_hoa_mau": ["sinh_hoa_mau", "duong_huyet", "mau_duong_mau", "glucose_mau", "sinh_hoa"],
    "xet_nghiem_nuoc_tieu": ["xet_nghiem_nuoc_tieu", "nuoc_tieu", "nuoc_tieu_khac", "tong_phan_tich_nuoc_tieu"],
    "hang_bang_lai": ["hang_bang_lai", "hangxe", "hang_xe", "hang_gplx"],
    "test_ma_tuy": ["test_ma_tuy", "matuy", "ma_tuy", "xet_nghiem_ma_tuy"],
    "nong_do_con": ["nong_do_con", "nongdocon", "con_trong_mau", "ethanol"],
    "phan_loai_sk": ["phan_loai_sk", "phan_loai_suc_khoe", "phanloai", "phan_loai", "xep_loai_sk"],
    "ket_luan_benh": ["ket_luan_benh", "ket_luan_benh_tat", "kl_benh", "ket_luan", "cac_benh_tat_neu_co"],
    "bs_ket_luan": ["bs_ket_luan", "bac_si_ket_luan", "ma_bs_ket_luan", "kl_manv", "ketluan_manv", "ten_bs_ket_luan"],
    "cchn_bs_ket_luan": ["cchn_bs_ket_luan", "so_cchn", "cchn", "ma_cchn_bs", "cchn_bac_si"],
    "chuky_ket_luan": ["chuky_ket_luan", "chu_ky_ket_luan", "da_ky_ket_luan", "ky_ket_luan", "bs_kl_da_ky"],
    "chuky_chuyen_khoa": ["chuky_chuyen_khoa", "chu_ky_chuyen_khoa", "da_ky_chuyen_khoa", "ky_chuyen_khoa", "daky_str"],
    "ngay_ket_luan": ["ngay_ket_luan", "kl_ngay", "ngayketluan"],
}

ALIAS_TO_CANONICAL: Dict[str, str] = {}
for canonical, aliases in HEADER_ALIASES.items():
    for alias in aliases:
        ALIAS_TO_CANONICAL[alias] = canonical


def format_date_value(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s or s.lower() in ("none", "null", "nan"):
        return ""
    # Nếu định dạng DD/MM/YYYY
    m_dmy = re.match(r"^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", s)
    if m_dmy:
        d, m, y = int(m_dmy.group(1)), int(m_dmy.group(2)), int(m_dmy.group(3))
        return f"{y:04d}-{m:02d}-{d:02d}"
    # Nếu định dạng YYYY-MM-DD HH:MM:SS -> giữ YYYY-MM-DD
    m_ymd = re.match(r"^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})", s)
    if m_ymd:
        y, m, d = int(m_ymd.group(1)), int(m_ymd.group(2)), int(m_ymd.group(3))
        return f"{y:04d}-{m:02d}-{d:02d}"
    # Nếu chỉ có 4 chữ số năm sinh (ví dụ: 1988)
    if re.match(r"^\d{4}$", s):
        return f"{s}-01-01"
    return s


def normalize_row_dict(raw_row: Dict[str, Any], row_idx: int) -> Dict[str, Any]:
    rec: Dict[str, Any] = {k: "" for k in HEADER_ALIASES.keys()}

    for raw_k, raw_v in raw_row.items():
        norm_k = normalize_header_key(raw_k)
        canonical_k = ALIAS_TO_CANONICAL.get(norm_k)
        if not canonical_k:
            # Thử khớp tiền tố
            for alias_k, target_k in ALIAS_TO_CANONICAL.items():
                if norm_k.startswith(alias_k):
                    canonical_k = target_k
                    break
        if canonical_k:
            if canonical_k in ("ngay_sinh", "ngay_kham", "ngay_ket_luan"):
                rec[canonical_k] = format_date_value(raw_v)
            else:
                if raw_v is None:
                    val_str = ""
                elif isinstance(raw_v, float) and raw_v.is_integer():
                    val_str = str(int(raw_v))
                else:
                    val_str = str(raw_v).strip()
                rec[canonical_k] = "" if val_str.lower() in ("none", "null", "nan") else val_str

    # Bảo toàn số 0 ở đầu cho CCCD 12 số và SĐT 10 số khi Excel ép kiểu số
    cccd = re.sub(r"[\s\.\-]", "", rec.get("so_cccd", ""))
    if cccd.isdigit() and len(cccd) == 11:
        cccd = "0" + cccd
    rec["so_cccd"] = cccd

    sdt = re.sub(r"[\s\.\-]", "", rec.get("so_dien_thoai", ""))
    if sdt.isdigit() and len(sdt) == 9 and not sdt.startswith("0"):
        sdt = "0" + sdt
    rec["so_dien_thoai"] = sdt

    # Chuẩn hóa giới tính
    gt = rec.get("gioi_tinh", "").strip()
    if gt in ("1", "nam", "Nam", "NAM", "M", "Male"):
        rec["gioi_tinh"] = "Nam"
    elif gt in ("2", "0", "nữ", "nu", "Nữ", "NU", "NỮ", "F", "Female"):
        rec["gioi_tinh"] = "Nữ"

    # Chuẩn hóa loại KSK
    lk = rec.get("loai_ksk", "").strip().upper()
    if "LAI" in lk or "LÁI" in lk or "GPLX" in lk or rec.get("hang_bang_lai"):
        rec["loai_ksk"] = "LAI_XE"
    else:
        rec["loai_ksk"] = "DINH_KY"

    # Tự động tính BMI nếu có chiều cao & cân nặng mà chưa có BMI
    if not rec.get("bmi") and rec.get("chieu_cao") and rec.get("can_nang"):
        try:
            cc = float(str(rec["chieu_cao"]).replace(",", "."))
            cn = float(str(rec["can_nang"]).replace(",", "."))
            if cc > 0 and cn > 0:
                rec["bmi"] = str(round(cn / ((cc / 100.0) ** 2), 2))
        except Exception:
            pass

    if not rec.get("ngay_ket_luan") and rec.get("ngay_kham"):
        rec["ngay_ket_luan"] = rec["ngay_kham"]

    if not rec.get("ma_benh_nhan") and rec.get("ma_kcb"):
        rec["ma_benh_nhan"] = f"BN_{rec['ma_kcb']}"

    rec["row_index"] = row_idx
    return rec


def parse_uploaded_file(filename: str, content: bytes) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Đọc file CSV hoặc Excel do người dùng upload và trả về (file_type, danh_sách_bản_ghi).
    Chỉ chấp nhận .csv, .xlsx, .xls.
    """
    lower_name = (filename or "").lower().strip()
    if lower_name.endswith(".csv"):
        file_type = "CSV"
        rows = _parse_csv_bytes(content)
    elif lower_name.endswith(".xlsx") or lower_name.endswith(".xls"):
        file_type = "EXCEL"
        rows = _parse_excel_bytes(content)
    else:
        raise ValueError(
            f"Định dạng file '{filename}' không được hỗ trợ! Hệ thống hiện tại chỉ hỗ trợ 2 định dạng: CSV (.csv) và Excel (.xlsx, .xls)."
        )

    normalized_records = []
    for idx, raw_row in enumerate(rows, start=1):
        # Bỏ qua dòng trống hoàn toàn
        if not any(str(v or "").strip() for v in raw_row.values()):
            continue
        norm = normalize_row_dict(raw_row, idx)
        # Bỏ qua dòng không có cả mã KCB lẫn họ tên
        if not norm.get("ma_kcb") and not norm.get("ho_va_ten"):
            continue
        normalized_records.append(norm)

    if not normalized_records:
        raise ValueError("Không tìm thấy dòng dữ liệu hồ sơ khám sức khỏe nào hợp lệ trong file.")

    return file_type, normalized_records


def _parse_csv_bytes(content: bytes) -> List[Dict[str, Any]]:
    text = None
    for enc in ("utf-8-sig", "utf-8", "cp1258", "windows-1252", "latin-1"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        text = content.decode("utf-8", errors="replace")

    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return []

    sample = "\n".join(lines[:5])
    delimiter = ","
    if sample.count(";") > sample.count(","):
        delimiter = ";"
    elif sample.count("\t") > sample.count(","):
        delimiter = "\t"

    reader = csv.DictReader(io.StringIO("\n".join(lines)), delimiter=delimiter)
    return [dict(r) for r in reader]


def _parse_excel_bytes(content: bytes) -> List[Dict[str, Any]]:
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    ws = wb.active

    all_rows = list(ws.iter_rows(values_only=True))
    if not all_rows:
        return []

    # Tự động tìm dòng Header (dòng chứa ít nhất 3 cột khớp tên trường chuẩn như Mã KCB, Họ tên, CCCD...)
    header_row_idx = 0
    best_match_score = 0
    for idx, row in enumerate(all_rows[:10]):
        score = 0
        for cell_val in row:
            norm_k = normalize_header_key(cell_val)
            if norm_k in ALIAS_TO_CANONICAL:
                score += 1
        if score > best_match_score:
            best_match_score = score
            header_row_idx = idx

    headers = [str(h or f"col_{i}").strip() for i, h in enumerate(all_rows[header_row_idx])]
    result = []
    for data_row in all_rows[header_row_idx + 1 :]:
        row_dict = {}
        for i, val in enumerate(data_row):
            if i < len(headers):
                row_dict[headers[i]] = val
        result.append(row_dict)
    return result


# ==================== DỮ LIỆU MẪU CHUẨN ĐỂ TẢI VỀ / TEST NGAY ====================
SAMPLE_COLUMNS = [
    ("ma_kcb", "Mã KCB"),
    ("ma_benh_nhan", "Mã BN"),
    ("ho_va_ten", "Họ và tên"),
    ("so_cccd", "Số CCCD"),
    ("ngay_sinh", "Ngày sinh"),
    ("gioi_tinh", "Giới tính"),
    ("so_dien_thoai", "Số điện thoại"),
    ("dia_chi", "Địa chỉ"),
    ("ngay_kham", "Ngày khám"),
    ("loai_ksk", "Loại KSK"),
    ("chieu_cao", "Chiều cao (cm)"),
    ("can_nang", "Cân nặng (kg)"),
    ("bmi", "BMI"),
    ("mach", "Mạch"),
    ("huyet_ap", "Huyết áp"),
    ("kham_noi_khoa", "Khám Nội khoa"),
    ("kham_ngoai_khoa", "Khám Ngoại khoa"),
    ("kham_san_phu_khoa", "Khám Sản phụ khoa"),
    ("kham_mat", "Khám Mắt"),
    ("kham_tmh", "Khám TMH"),
    ("kham_rhm", "Khám RHM"),
    ("kham_da_lieu", "Khám Da liễu"),
    ("x_quang_phoi", "Ket_Qua_XQuang"),
    ("cong_thuc_mau", "Công thức máu"),
    ("sinh_hoa_mau", "Đường huyết"),
    ("xet_nghiem_nuoc_tieu", "Xét nghiệm nước tiểu"),
    ("hang_bang_lai", "Hạng bằng lái"),
    ("test_ma_tuy", "Test Ma túy"),
    ("nong_do_con", "Nồng độ cồn"),
    ("phan_loai_sk", "Phân loại sức khỏe"),
    ("ket_luan_benh", "Kết luận bệnh tật"),
    ("bs_ket_luan", "Bác sĩ kết luận"),
    ("cchn_bs_ket_luan", "CCHN Bác sĩ kết luận"),
    ("chuky_chuyen_khoa", "Chữ ký chuyên khoa"),
    ("chuky_ket_luan", "Chữ ký kết luận"),
    ("ngay_ket_luan", "Ngày kết luận"),
]

SAMPLE_ROWS_DATA = [
    {
        "ma_kcb": "2600950001",
        "ma_benh_nhan": "BN00215901",
        "ho_va_ten": "NGUYỄN VĂN MINH",
        "so_cccd": "091088012345",
        "ngay_sinh": "1988-05-14",
        "gioi_tinh": "Nam",
        "so_dien_thoai": "0918234567",
        "dia_chi": "Phường Vĩnh Thanh Vân, TP. Rạch Giá, Kiên Giang",
        "ngay_kham": "2026-11-10",
        "loai_ksk": "DINH_KY",
        "chieu_cao": "170",
        "can_nang": "66",
        "bmi": "22.84",
        "mach": "76",
        "huyet_ap": "120/80",
        "kham_noi_khoa": "Bình thường",
        "kham_ngoai_khoa": "Bình thường",
        "kham_san_phu_khoa": "",
        "kham_mat": "Thị lực hai mắt 10/10",
        "kham_tmh": "Tai mũi họng bình thường",
        "kham_rhm": "Răng hàm mặt bình thường",
        "kham_da_lieu": "Da liễu bình thường",
        "x_quang_phoi": "Hình ảnh tim phổi trong giới hạn bình thường",
        "cong_thuc_mau": "Các chỉ số huyết học trong giới hạn bình thường",
        "sinh_hoa_mau": "5.1 mmol/L",
        "xet_nghiem_nuoc_tieu": "Tổng phân tích nước tiểu bình thường",
        "hang_bang_lai": "",
        "test_ma_tuy": "",
        "nong_do_con": "",
        "phan_loai_sk": "LOAI_I",
        "ket_luan_benh": "Hiện tại sức khỏe bình thường, đủ sức khỏe làm việc",
        "bs_ket_luan": "BS.CKI TRẦN VĂN HÙNG",
        "cchn_bs_ket_luan": "001256/KG-CCHN",
        "chuky_chuyen_khoa": "Đã ký đủ",
        "chuky_ket_luan": "Đã ký",
        "ngay_ket_luan": "2026-11-10",
    },
    {
        "ma_kcb": "2600950002",
        "ma_benh_nhan": "BN00215902",
        "ho_va_ten": "LÊ THỊ NGỌC LAN",
        "so_cccd": "091192045678",
        "ngay_sinh": "1992-08-22",
        "gioi_tinh": "Nữ",
        "so_dien_thoai": "0987654321",
        "dia_chi": "Phường Vĩnh Lạc, TP. Rạch Giá, Kiên Giang",
        "ngay_kham": "2026-11-10",
        "loai_ksk": "DINH_KY",
        "chieu_cao": "158",
        "can_nang": "52",
        "bmi": "20.83",
        "mach": "74",
        "huyet_ap": "110/70",
        "kham_noi_khoa": "Bình thường",
        "kham_ngoai_khoa": "Bình thường",
        "kham_san_phu_khoa": "Sản phụ khoa bình thường",
        "kham_mat": "Thị lực hai mắt 10/10",
        "kham_tmh": "Tai mũi họng bình thường",
        "kham_rhm": "Sức nhai 95%",
        "kham_da_lieu": "Bình thường",
        "x_quang_phoi": "Hình ảnh tim phổi bình thường",
        "cong_thuc_mau": "Tổng phân tích tế bào máu bình thường",
        "sinh_hoa_mau": "4.9 mmol/L",
        "xet_nghiem_nuoc_tieu": "Nước tiểu tự động bình thường",
        "hang_bang_lai": "",
        "test_ma_tuy": "",
        "nong_do_con": "",
        "phan_loai_sk": "LOAI_I",
        "ket_luan_benh": "Sức khỏe Loại I",
        "bs_ket_luan": "BS.CKI TRẦN VĂN HÙNG",
        "cchn_bs_ket_luan": "001256/KG-CCHN",
        "chuky_chuyen_khoa": "Đã ký đủ",
        "chuky_ket_luan": "Đã ký",
        "ngay_ket_luan": "2026-11-10",
    },
    {
        "ma_kcb": "2600950003",
        "ma_benh_nhan": "BN00215903",
        "ho_va_ten": "PHẠM HOÀNG NAM",
        "so_cccd": "091095067890",
        "ngay_sinh": "1995-03-10",
        "gioi_tinh": "Nam",
        "so_dien_thoai": "0909112233",
        "dia_chi": "Thị trấn Minh Lương, Châu Thành, Kiên Giang",
        "ngay_kham": "2026-11-10",
        "loai_ksk": "LAI_XE",
        "chieu_cao": "168",
        "can_nang": "65",
        "bmi": "23.03",
        "mach": "78",
        "huyet_ap": "120/80",
        "kham_noi_khoa": "Bình thường",
        "kham_ngoai_khoa": "Bình thường",
        "kham_san_phu_khoa": "",
        "kham_mat": "Thị lực hai mắt 10/10, không mù màu",
        "kham_tmh": "Thính lực tốt",
        "kham_rhm": "Bình thường",
        "kham_da_lieu": "Bình thường",
        "x_quang_phoi": "Tim phổi bình thường",
        "cong_thuc_mau": "Bình thường",
        "sinh_hoa_mau": "5.0 mmol/L",
        "xet_nghiem_nuoc_tieu": "Bình thường",
        "hang_bang_lai": "B",
        "test_ma_tuy": "Âm tính (4 chất)",
        "nong_do_con": "0 mg/L (Âm tính)",
        "phan_loai_sk": "DU_DIEU_KIEN",
        "ket_luan_benh": "Đủ điều kiện sức khỏe lái xe hạng B",
        "bs_ket_luan": "BS.CKI TRẦN VĂN HÙNG",
        "cchn_bs_ket_luan": "001256/KG-CCHN",
        "chuky_chuyen_khoa": "Đã ký đủ",
        "chuky_ket_luan": "Đã ký",
        "ngay_ket_luan": "2026-11-10",
    },
    {
        "ma_kcb": "2600950004",
        "ma_benh_nhan": "BN00215904",
        "ho_va_ten": "TRƯƠNG VĂN ĐẠT",
        "so_cccd": "091085033445",
        "ngay_sinh": "1985-11-19",
        "gioi_tinh": "Nam",
        "so_dien_thoai": "0939887766",
        "dia_chi": "Phường An Hòa, TP. Rạch Giá, Kiên Giang",
        "ngay_kham": "2026-11-10",
        "loai_ksk": "DINH_KY",
        "chieu_cao": "165",
        "can_nang": "62",
        "bmi": "22.77",
        "mach": "72",
        "huyet_ap": "120/80",
        "kham_noi_khoa": "Bình thường",
        "kham_ngoai_khoa": "Bình thường",
        "kham_san_phu_khoa": "",
        "kham_mat": "Thị lực 9/10",
        "kham_tmh": "Bình thường",
        "kham_rhm": "Bình thường",
        "kham_da_lieu": "Bình thường",
        "x_quang_phoi": "Tim phổi bình thường",
        "cong_thuc_mau": "Bình thường",
        "sinh_hoa_mau": "5.3 mmol/L",
        "xet_nghiem_nuoc_tieu": "Bình thường",
        "hang_bang_lai": "",
        "test_ma_tuy": "",
        "nong_do_con": "",
        "phan_loai_sk": "LOAI_II",
        "ket_luan_benh": "Sức khỏe Loại II - Đủ điều kiện làm việc",
        "bs_ket_luan": "BS.CKI TRẦN VĂN HÙNG",
        "cchn_bs_ket_luan": "001256/KG-CCHN",
        "chuky_chuyen_khoa": "Đã ký đủ",
        "chuky_ket_luan": "Đã ký",
        "ngay_ket_luan": "2026-11-10",
    },
    # Hồ sơ thứ 5 cố tình để thiếu CCCD và chưa ký kết luận để minh họa tính năng Chặn & Bổ sung trước khi Ký số
    {
        "ma_kcb": "2600950005",
        "ma_benh_nhan": "BN00215905",
        "ho_va_ten": "ĐẶNG THỊ MAI HƯƠNG",
        "so_cccd": "",
        "ngay_sinh": "1996-07-02",
        "gioi_tinh": "Nữ",
        "so_dien_thoai": "0945123789",
        "dia_chi": "Phường Vĩnh Bảo, TP. Rạch Giá, Kiên Giang",
        "ngay_kham": "2026-11-10",
        "loai_ksk": "DINH_KY",
        "chieu_cao": "160",
        "can_nang": "50",
        "bmi": "19.53",
        "mach": "75",
        "huyet_ap": "115/75",
        "kham_noi_khoa": "Bình thường",
        "kham_ngoai_khoa": "Bình thường",
        "kham_san_phu_khoa": "Bình thường",
        "kham_mat": "Thị lực 10/10",
        "kham_tmh": "Bình thường",
        "kham_rhm": "Bình thường",
        "kham_da_lieu": "Bình thường",
        "x_quang_phoi": "Tim phổi bình thường",
        "cong_thuc_mau": "Bình thường",
        "sinh_hoa_mau": "4.8 mmol/L",
        "xet_nghiem_nuoc_tieu": "Bình thường",
        "hang_bang_lai": "",
        "test_ma_tuy": "",
        "nong_do_con": "",
        "phan_loai_sk": "LOAI_I",
        "ket_luan_benh": "Sức khỏe bình thường",
        "bs_ket_luan": "BS.CKI TRẦN VĂN HÙNG",
        "cchn_bs_ket_luan": "001256/KG-CCHN",
        "chuky_chuyen_khoa": "Đã ký đủ",
        "chuky_ket_luan": "Chưa ký",
        "ngay_ket_luan": "2026-11-10",
    },
]


def build_sample_excel_bytes() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Danh_Sach_KSK"

    header_fill = PatternFill(start_color="0F4C81", end_color="0F4C81", fill_type="solid")
    header_font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
    data_font = Font(name="Arial", size=10)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    for col_idx, (_, col_label) in enumerate(SAMPLE_COLUMNS, start=1):
        cell = ws.cell(1, col_idx, col_label)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
        ws.column_dimensions[get_column_letter(col_idx)].width = max(15, len(col_label) + 4)

    for row_idx, row_data in enumerate(SAMPLE_ROWS_DATA, start=2):
        for col_idx, (field_key, _) in enumerate(SAMPLE_COLUMNS, start=1):
            cell = ws.cell(row_idx, col_idx, row_data.get(field_key, ""))
            cell.font = data_font
            cell.border = thin_border
            if field_key in ("so_cccd", "so_dien_thoai", "ma_kcb"):
                cell.number_format = "@"

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def build_sample_csv_bytes() -> bytes:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([label for _, label in SAMPLE_COLUMNS])
    for row_data in SAMPLE_ROWS_DATA:
        writer.writerow([row_data.get(key, "") for key, _ in SAMPLE_COLUMNS])
    return out.getvalue().encode("utf-8-sig")


def ensure_sample_files_on_disk():
    try:
        xlsx_path = SAMPLES_DIR / "mau_import_ksk_quoc_gia.xlsx"
        csv_path = SAMPLES_DIR / "mau_import_ksk_quoc_gia.csv"
        if not xlsx_path.exists():
            xlsx_path.write_bytes(build_sample_excel_bytes())
        if not csv_path.exists():
            csv_path.write_bytes(build_sample_csv_bytes())
    except Exception as e:
        print(f"[WARN] Không thể tạo file mẫu trong samples/: {e}")
