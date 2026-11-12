import sqlite3
from typing import Optional, List, Callable, Dict, Any
from fastapi import HTTPException, Header, Request, Depends

from server.database.db import get_conn, SYSTEM_PERMISSIONS
from server.core.security import decode_access_token


def _is_docker_bridge_ip(ip: str) -> bool:
    if ip.startswith("192.168.65."):
        # Subnet NAT nội bộ mặc định của Docker Desktop (Windows / macOS)
        return True
    parts = ip.split(".")
    if len(parts) == 4 and parts[0] == "172":
        try:
            second = int(parts[1])
            return 16 <= second <= 31
        except ValueError:
            return False
    return False


def extract_client_ip(request: Optional[Request]) -> str:
    if not request:
        return "127.0.0.1"
    raw = ""
    sock_ip = (request.client.host if request.client else "") or ""
    sock_ip = sock_ip.strip()
    if sock_ip.startswith("::ffff:"):
        sock_ip = sock_ip[7:]
    if sock_ip == "::1":
        sock_ip = "127.0.0.1"

    fwd = (
        (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        or (request.headers.get("x-real-ip") or "").strip()
    )
    if fwd.startswith("::ffff:"):
        fwd = fwd[7:]
    if fwd == "::1":
        fwd = "127.0.0.1"

    reported_lan = (request.headers.get("x-client-lan-ip") or "").strip()
    valid_reported_lan = (
        reported_lan
        if reported_lan and reported_lan not in ("127.0.0.1", "localhost", "0.0.0.0")
        else ""
    )

    if sock_ip in ("", "127.0.0.1", "localhost", "testclient"):
        if fwd and fwd not in ("127.0.0.1", "localhost", "testclient") and not _is_docker_bridge_ip(fwd):
            raw = fwd
        elif valid_reported_lan:
            raw = valid_reported_lan
        else:
            raw = "127.0.0.1"
    elif _is_docker_bridge_ip(sock_ip):
        # Khi chạy trong Docker (qua Nginx reverse proxy hoặc Docker Desktop NAT từ máy chủ Host)
        if fwd and fwd not in ("127.0.0.1", "localhost") and not _is_docker_bridge_ip(fwd):
            raw = fwd
        elif valid_reported_lan:
            raw = valid_reported_lan
        elif fwd:
            raw = fwd
        else:
            raw = sock_ip
    else:
        raw = sock_ip

    return raw or "127.0.0.1"


def assert_ip_not_blocked(conn: sqlite3.Connection, client_ip: str):
    row = conn.execute(
        "SELECT is_blocked, blocked_reason FROM client_sessions WHERE client_ip = ?",
        (client_ip,),
    ).fetchone()
    if row and int(row["is_blocked"] or 0) == 1:
        reason = row["blocked_reason"] or "Chặn bởi Quản trị viên hệ thống"
        raise HTTPException(
            status_code=403,
            detail=f"Địa chỉ IP máy trạm ({client_ip}) đã bị chặn truy cập hệ thống. Lý do: {reason}",
            headers={"X-Block-Code": "IP_BLOCKED"},
        )


def is_admin_role(role: Optional[str]) -> bool:
    return (role or "").strip().lower() == "admin"


def get_user_effective_permissions(conn: sqlite3.Connection, user_row: Dict[str, Any]) -> List[str]:
    """Tính tập quyền hiệu lực theo công thức thừa kế cộng dồn 3 tầng: A ∪ B ∪ C."""
    if is_admin_role(user_row.get("role")):
        all_codes = [p[0] for p in SYSTEM_PERMISSIONS]
        return ["0", "*", *all_codes]

    uid = int(user_row["id"])
    pos_id = user_row.get("position_id")

    codes_set = set()

    # Tầng A: Quyền từ tất cả Khoa/Phòng đang hoạt động mà user trực thuộc
    dept_rows = conn.execute(
        """
        SELECT p.perm_code
        FROM permissions p
        JOIN department_permissions dp ON dp.permission_id = p.id
        JOIN departments d ON d.id = dp.department_id
        JOIN user_department ud ON ud.department_id = d.id
        WHERE ud.user_id = ? AND d.is_active = 1
        """,
        (uid,),
    ).fetchall()
    for r in dept_rows:
        codes_set.add(r["perm_code"])

    # Tầng B: Quyền từ Chức vụ đang hoạt động
    if pos_id:
        pos_rows = conn.execute(
            """
            SELECT p.perm_code
            FROM permissions p
            JOIN position_permissions pp ON pp.permission_id = p.id
            JOIN positions pos ON pos.id = pp.position_id
            WHERE pp.position_id = ? AND pos.is_active = 1
            """,
            (int(pos_id),),
        ).fetchall()
        for r in pos_rows:
            codes_set.add(r["perm_code"])

    # Tầng C: Quyền cấp riêng cho Cá nhân
    indiv_rows = conn.execute(
        """
        SELECT p.perm_code
        FROM permissions p
        JOIN user_permissions up ON up.permission_id = p.id
        WHERE up.user_id = ? AND up.is_granted = 1
        """,
        (uid,),
    ).fetchall()
    for r in indiv_rows:
        codes_set.add(r["perm_code"])

    # Giữ thứ tự chuẩn theo SYSTEM_PERMISSIONS
    order_map = {code: idx for idx, (code, *_) in enumerate(SYSTEM_PERMISSIONS)}
    return sorted(codes_set, key=lambda c: order_map.get(c, 9999))


def enrich_user(conn: sqlite3.Connection, user_row: Dict[str, Any]) -> Dict[str, Any]:
    uid = int(user_row["id"])
    depts = conn.execute(
        """
        SELECT d.id, d.name, d.name_en, d.is_active
        FROM departments d
        JOIN user_department ud ON ud.department_id = d.id
        WHERE ud.user_id = ? AND d.is_active = 1
        ORDER BY d.id ASC
        """,
        (uid,),
    ).fetchall()
    dept_list = [
        {"id": d["id"], "name": d["name"], "name_en": d["name_en"] or ""}
        for d in depts
    ]

    pos_name = None
    pos_code = None
    pos_dept_id = None
    if user_row.get("position_id"):
        p_row = conn.execute(
            "SELECT id, code, name, department_id, is_active FROM positions WHERE id = ?",
            (int(user_row["position_id"]),),
        ).fetchone()
        if p_row:
            pos_name = p_row["name"]
            pos_code = p_row["code"]
            pos_dept_id = p_row["department_id"]

    role_norm = (user_row.get("role") or "staff").strip().lower()
    is_admin = role_norm == "admin"
    perms = get_user_effective_permissions(conn, user_row)

    return {
        "id": uid,
        "username": user_row["username"],
        "full_name": user_row["full_name"],
        "email": user_row.get("email") or "",
        "phone": user_row.get("phone") or "",
        "cchn": user_row.get("cchn") or "",
        "role": role_norm,
        "is_admin": is_admin,
        "permission_level": 0 if is_admin else 1,
        "is_active": bool(user_row.get("is_active", 1)),
        "position_id": user_row.get("position_id"),
        "position_name": pos_name,
        "position_code": pos_code,
        "position_department_id": pos_dept_id,
        "departments": dept_list,
        "department_ids": [d["id"] for d in dept_list],
        "department_names": [d["name"] for d in dept_list],
        "permissions": perms,
        "last_login": user_row.get("last_login"),
        "created_at": user_row.get("created_at"),
    }


def _resolve_auth_user(
    request: Request,
    authorization: Optional[str],
    strict: bool = True,
) -> Optional[Dict[str, Any]]:
    client_ip = extract_client_ip(request)
    conn = get_conn()
    try:
        assert_ip_not_blocked(conn, client_ip)

        if not authorization or not authorization.startswith("Bearer "):
            if strict:
                raise HTTPException(status_code=401, detail="Thiếu hoặc sai định dạng Bearer Token")
            return None

        token = authorization.split(" ", 1)[1].strip()
        payload = decode_access_token(token)
        if not payload:
            if strict:
                raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn hoặc không hợp lệ")
            return None

        username = payload.get("sub", "")
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if not row:
            if strict:
                raise HTTPException(status_code=401, detail="Tài khoản không tồn tại")
            return None

        user_dict = dict(row)
        if not int(user_dict.get("is_active") or 0):
            if strict:
                raise HTTPException(status_code=401, detail="Tài khoản đã bị khóa bởi Quản trị viên")
            return None

        # Kiểm tra token_version (dùng khi khóa tài khoản / thu hồi toàn bộ phiên)
        token_tv = payload.get("tv")
        db_tv = int(user_dict.get("token_version") or 1)
        if token_tv is not None and int(token_tv) != db_tv:
            if strict:
                raise HTTPException(
                    status_code=401,
                    detail="Phiên đăng nhập đã bị thu hồi hoặc mật khẩu/trạng thái tài khoản vừa thay đổi. Vui lòng đăng nhập lại.",
                )
            return None

        # Kiểm tra thu hồi phiên theo IP máy trạm (khi Admin bấm Đăng xuất tài khoản từ xa trên IP này)
        revoke_key = f"ip:{client_ip}:u:{user_dict['id']}"[:64]
        session_uid = (request.headers.get("x-session-uid") or "").strip()[:128]
        revoked_keys = [revoke_key]
        if session_uid:
            revoked_keys.append(session_uid)

        placeholders = ",".join(["?"] * len(revoked_keys))
        rev_row = conn.execute(
            f"SELECT session_uid FROM revoked_sessions WHERE session_uid IN ({placeholders}) LIMIT 1",
            revoked_keys,
        ).fetchone()
        if rev_row:
            if strict:
                raise HTTPException(
                    status_code=401,
                    detail="Phiên đăng nhập của tài khoản trên thiết bị này đã được Quản trị viên đăng xuất. Vui lòng đăng nhập lại.",
                )
            return None

        return enrich_user(conn, user_dict)
    finally:
        conn.close()


def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> Dict[str, Any]:
    return _resolve_auth_user(request, authorization, strict=True)


def get_current_user_optional(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> Optional[Dict[str, Any]]:
    return _resolve_auth_user(request, authorization, strict=False)


def user_has_permission(user: Optional[Dict[str, Any]], perm_code: str) -> bool:
    if not user:
        return False
    if user.get("is_admin") or is_admin_role(user.get("role")):
        return True
    perms = set(user.get("permissions") or [])
    if "0" in perms or "*" in perms:
        return True
    return perm_code in perms


def require_permission(perm_code: str) -> Callable:
    def _dep(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if not user_has_permission(current_user, perm_code):
            raise HTTPException(
                status_code=403,
                detail=f"Tài khoản của bạn chưa được cấp quyền thực hiện chức năng này (Mã quyền: {perm_code}).",
            )
        return current_user

    return _dep


def require_any_permission(*perm_codes: str) -> Callable:
    def _dep(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if any(user_has_permission(current_user, code) for code in perm_codes):
            return current_user
        codes_str = ", ".join(perm_codes)
        raise HTTPException(
            status_code=403,
            detail=f"Tài khoản của bạn chưa được cấp quyền truy cập khu vực này (Cần 1 trong các quyền: {codes_str}).",
        )

    return _dep
