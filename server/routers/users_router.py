import sqlite3
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel

from server.database.db import (
    get_conn,
    now_vn_str,
    add_audit_log,
    sync_system_permissions,
)
from server.core.security import hash_password
from server.core.deps import (
    get_current_user,
    require_permission,
    require_any_permission,
    enrich_user,
    get_user_effective_permissions,
    extract_client_ip,
)

router = APIRouter(prefix="/api/users", tags=["Người dùng & Phân quyền"])

VALID_ROLES = {"admin", "truong_phong", "staff"}


class UserCreateIn(BaseModel):
    username: str
    password: str
    full_name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    cchn: Optional[str] = ""
    role: str = "staff"
    position_id: Optional[int] = None
    department_ids: List[int] = []
    is_active: bool = True


class UserUpdateIn(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    cchn: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    position_id: Optional[int] = None
    clear_position: bool = False
    department_ids: Optional[List[int]] = None
    is_active: Optional[bool] = None


class AssignDepartmentHeadIn(BaseModel):
    new_head_user_id: int


class UserPermissionsUpdateIn(BaseModel):
    permission_ids: Optional[List[int]] = None
    perm_codes: Optional[List[str]] = None


def _normalize_role(role: Optional[str]) -> str:
    r = (role or "staff").strip().lower()
    if r not in VALID_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Vai trò '{role}' không hợp lệ. Chỉ chấp nhận: admin, truong_phong, staff.",
        )
    return r


def _validate_position_and_departments(
    conn: sqlite3.Connection,
    position_id: Optional[int],
    department_ids: List[int],
):
    valid_dept_ids: List[int] = []
    for did in department_ids:
        d = conn.execute("SELECT id, name, is_active FROM departments WHERE id = ?", (int(did),)).fetchone()
        if not d:
            raise HTTPException(status_code=404, detail=f"Khoa/Phòng #{did} không tồn tại")
        if int(did) not in valid_dept_ids:
            valid_dept_ids.append(int(did))

    if position_id:
        pos = conn.execute("SELECT id, name, department_id FROM positions WHERE id = ?", (int(position_id),)).fetchone()
        if not pos:
            raise HTTPException(status_code=404, detail="Chức vụ đã chọn không tồn tại")
        if pos["department_id"] and pos["department_id"] not in valid_dept_ids:
            # Tự động gắn Khoa/Phòng của chức vụ vào danh sách Khoa/Phòng của nhân sự để đảm bảo nhất quán
            valid_dept_ids.append(int(pos["department_id"]))

    return valid_dept_ids


def _serialize_user_for_admin(conn: sqlite3.Connection, row: sqlite3.Row) -> Dict[str, Any]:
    u = enrich_user(conn, dict(row))
    direct_cnt = conn.execute(
        "SELECT COUNT(*) AS cnt FROM user_permissions WHERE user_id = ? AND is_granted = 1",
        (u["id"],),
    ).fetchone()["cnt"]
    u["direct_permission_count"] = direct_cnt or 0
    u["effective_permission_count"] = len([c for c in u["permissions"] if c not in ("0", "*")])
    return u


# ─── DANH MỤC QUYỀN HỆ THỐNG (Đặt trước /{user_id}) ──────────────────────────

@router.get("/permissions")
@router.get("/permissions/all")
def list_all_system_permissions(current_user: Dict[str, Any] = Depends(get_current_user)):
    conn = get_conn()
    try:
        cur = conn.cursor()
        sync_system_permissions(cur)
        conn.commit()
        rows = conn.execute("SELECT * FROM permissions ORDER BY sort_order ASC, id ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ─── GÁN TRƯỞNG PHÒNG ATOMIC (Đặt trước /{user_id}) ──────────────────────────

@router.put("/departments/{dept_id}/assign-head")
def assign_department_head(
    dept_id: int,
    body: AssignDepartmentHeadIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_DEPT_MANAGE", "PERM_ORG_USER_MANAGE")
    ),
):
    conn = get_conn()
    try:
        dept = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not dept:
            raise HTTPException(status_code=404, detail="Không tìm thấy Khoa/Phòng")

        new_head = conn.execute("SELECT * FROM users WHERE id = ?", (body.new_head_user_id,)).fetchone()
        if not new_head:
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
        if not int(new_head["is_active"]):
            raise HTTPException(status_code=400, detail="Tài khoản đang bị khóa, không thể gán làm Trưởng phòng")

        in_dept = conn.execute(
            "SELECT 1 FROM user_department WHERE user_id = ? AND department_id = ?",
            (new_head["id"], dept_id),
        ).fetchone()
        if not in_dept:
            raise HTTPException(status_code=400, detail="Nhân sự này chưa trực thuộc Khoa/Phòng đang chọn")

        if (new_head["role"] or "").lower() == "admin":
            raise HTTPException(
                status_code=400,
                detail="Tài khoản Quản trị viên (Admin) không cần gán làm Trưởng khoa/phòng.",
            )

        # Hạ các Trưởng phòng cũ trong phòng này về staff trong cùng 1 transaction
        old_heads = conn.execute(
            """
            SELECT u.id, u.full_name
            FROM users u
            JOIN user_department ud ON ud.user_id = u.id
            WHERE ud.department_id = ? AND LOWER(u.role) = 'truong_phong' AND u.id != ?
            """,
            (dept_id, new_head["id"]),
        ).fetchall()

        demoted_names = []
        for oh in old_heads:
            conn.execute("UPDATE users SET role = 'staff' WHERE id = ?", (oh["id"],))
            demoted_names.append(oh["full_name"])

        conn.execute("UPDATE users SET role = 'truong_phong' WHERE id = ?", (new_head["id"],))
        conn.commit()

        msg = f"Đã gán '{new_head['full_name']}' làm Trưởng '{dept['name']}'"
        if demoted_names:
            msg += f" (chuyển về nhân viên: {', '.join(demoted_names)})"

        add_audit_log(
            current_user["username"],
            "ASSIGN_DEPT_HEAD",
            msg,
            "SUCCESS",
            extract_client_ip(request),
        )
        return {"success": True, "message": msg, "new_head_id": new_head["id"], "demoted": demoted_names}
    finally:
        conn.close()


# ─── CRUD NGƯỜI DÙNG ─────────────────────────────────────────────────────────

@router.get("")
def list_users(
    search: Optional[str] = Query(None),
    department_id: Optional[int] = Query(None),
    role: Optional[str] = Query(None),
    include_inactive: bool = Query(True),
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_USER_MANAGE", "PERM_ORG_DEPT_MANAGE", "PERM_ORG_PERMISSION_MANAGE")
    ),
):
    conn = get_conn()
    try:
        clauses = ["1=1"]
        params: List[Any] = []

        if not include_inactive:
            clauses.append("u.is_active = 1")
        if role and role.strip() and role.upper() != "ALL":
            clauses.append("LOWER(u.role) = ?")
            params.append(role.strip().lower())
        if department_id:
            clauses.append("EXISTS (SELECT 1 FROM user_department ud WHERE ud.user_id = u.id AND ud.department_id = ?)")
            params.append(department_id)
        if search and search.strip():
            q = f"%{search.strip()}%"
            clauses.append("(u.username LIKE ? OR u.full_name LIKE ? OR u.cchn LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)")
            params.extend([q, q, q, q, q])

        rows = conn.execute(
            f"""
            SELECT u.*
            FROM users u
            WHERE {' AND '.join(clauses)}
            ORDER BY u.is_active DESC,
                     CASE WHEN LOWER(u.role) = 'admin' THEN 0 WHEN LOWER(u.role) = 'truong_phong' THEN 1 ELSE 2 END,
                     u.id ASC
            """,
            params,
        ).fetchall()
        return [_serialize_user_for_admin(conn, r) for r in rows]
    finally:
        conn.close()


@router.post("")
def create_user(
    body: UserCreateIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_ORG_USER_MANAGE")),
):
    username = (body.username or "").strip()
    full_name = (body.full_name or "").strip()
    password = body.password or ""

    if not username or len(username) < 2:
        raise HTTPException(status_code=400, detail="Tên đăng nhập phải có ít nhất 2 ký tự")
    if not full_name:
        raise HTTPException(status_code=400, detail="Họ và tên nhân viên không được để trống")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Mật khẩu phải có ít nhất 4 ký tự")

    role_norm = _normalize_role(body.role)
    if role_norm == "admin" and not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Chỉ Quản trị viên tối cao (Admin) mới được tạo tài khoản Admin")

    conn = get_conn()
    try:
        dup = conn.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,)).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail=f"Tên đăng nhập '{username}' đã tồn tại")

        pos_id = body.position_id if body.position_id else None
        valid_dept_ids = _validate_position_and_departments(conn, pos_id, body.department_ids or [])

        now = now_vn_str()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO users (
                username, password_hash, full_name, email, phone, cchn,
                role, position_id, is_active, token_version, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (
                username,
                hash_password(password),
                full_name,
                (body.email or "").strip(),
                (body.phone or "").strip(),
                (body.cchn or "").strip(),
                role_norm,
                pos_id,
                1 if body.is_active else 0,
                now,
            ),
        )
        new_uid = cur.lastrowid

        for did in valid_dept_ids:
            cur.execute(
                "INSERT OR IGNORE INTO user_department (user_id, department_id) VALUES (?, ?)",
                (new_uid, did),
            )

        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id = ?", (new_uid,)).fetchone()
        add_audit_log(
            current_user["username"],
            "CREATE_USER",
            f"Tạo tài khoản nhân sự: {username} ({full_name}) - Vai trò: {role_norm}",
            "SUCCESS",
            extract_client_ip(request),
        )
        return _serialize_user_for_admin(conn, row)
    finally:
        conn.close()


@router.put("/{user_id}")
def update_user(
    user_id: int,
    body: UserUpdateIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_ORG_USER_MANAGE")),
):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")

        is_target_admin = (row["role"] or "").lower() == "admin"
        if is_target_admin and not current_user.get("is_admin"):
            raise HTTPException(status_code=403, detail="Chỉ Admin mới có quyền chỉnh sửa tài khoản Admin")

        new_full_name = body.full_name.strip() if body.full_name is not None else row["full_name"]
        if not new_full_name:
            raise HTTPException(status_code=400, detail="Họ và tên không được để trống")

        new_email = body.email.strip() if body.email is not None else (row["email"] or "")
        new_phone = body.phone.strip() if body.phone is not None else (row["phone"] or "")
        new_cchn = body.cchn.strip() if body.cchn is not None else (row["cchn"] or "")

        new_role = (row["role"] or "staff").lower()
        if body.role is not None:
            cand_role = _normalize_role(body.role)
            if cand_role == "admin" and not current_user.get("is_admin"):
                raise HTTPException(status_code=403, detail="Chỉ Admin mới được nâng quyền tài khoản lên Admin")
            if is_target_admin and cand_role != "admin":
                other_admins = conn.execute(
                    "SELECT COUNT(*) AS cnt FROM users WHERE LOWER(role) = 'admin' AND is_active = 1 AND id != ?",
                    (user_id,),
                ).fetchone()["cnt"]
                if other_admins == 0:
                    raise HTTPException(
                        status_code=400,
                        detail="Không thể hạ quyền tài khoản Admin hoạt động cuối cùng của hệ thống.",
                    )
            new_role = cand_role

        new_active = int(row["is_active"])
        bump_token = False
        if body.is_active is not None:
            if not body.is_active and user_id == current_user["id"]:
                raise HTTPException(status_code=400, detail="Bạn không thể tự khóa tài khoản của chính mình")
            if not body.is_active and is_target_admin:
                other_admins = conn.execute(
                    "SELECT COUNT(*) AS cnt FROM users WHERE LOWER(role) = 'admin' AND is_active = 1 AND id != ?",
                    (user_id,),
                ).fetchone()["cnt"]
                if other_admins == 0:
                    raise HTTPException(status_code=400, detail="Không thể khóa tài khoản Admin cuối cùng của hệ thống")
            if int(row["is_active"]) == 1 and not body.is_active:
                bump_token = True
            new_active = 1 if body.is_active else 0

        # Xác định Khoa/Phòng & Chức vụ mới
        if body.department_ids is not None:
            target_dept_ids = body.department_ids
        else:
            existing_depts = conn.execute(
                "SELECT department_id FROM user_department WHERE user_id = ?",
                (user_id,),
            ).fetchall()
            target_dept_ids = [r["department_id"] for r in existing_depts]

        if body.clear_position:
            new_pos_id = None
        elif body.position_id is not None:
            new_pos_id = body.position_id if body.position_id > 0 else None
        else:
            new_pos_id = row["position_id"]

        valid_dept_ids = _validate_position_and_departments(conn, new_pos_id, target_dept_ids)

        new_pw_hash = row["password_hash"]
        if body.password is not None and body.password.strip():
            if len(body.password.strip()) < 4:
                raise HTTPException(status_code=400, detail="Mật khẩu mới phải có ít nhất 4 ký tự")
            new_pw_hash = hash_password(body.password.strip())
            bump_token = True

        new_tv = int(row["token_version"] or 1) + (1 if bump_token else 0)

        conn.execute(
            """
            UPDATE users
            SET full_name = ?,
                email = ?,
                phone = ?,
                cchn = ?,
                password_hash = ?,
                role = ?,
                position_id = ?,
                is_active = ?,
                token_version = ?
            WHERE id = ?
            """,
            (
                new_full_name,
                new_email,
                new_phone,
                new_cchn,
                new_pw_hash,
                new_role,
                new_pos_id,
                new_active,
                new_tv,
                user_id,
            ),
        )

        if body.department_ids is not None or new_pos_id != row["position_id"]:
            conn.execute("DELETE FROM user_department WHERE user_id = ?", (user_id,))
            for did in valid_dept_ids:
                conn.execute(
                    "INSERT OR IGNORE INTO user_department (user_id, department_id) VALUES (?, ?)",
                    (user_id, did),
                )

        # Nếu tài khoản bị khóa, đồng thời đóng các phiên đang active trên máy trạm
        if new_active == 0:
            now_s = now_vn_str()
            conn.execute(
                "UPDATE client_sessions SET last_user_id = user_id, user_id = NULL, last_logout_at = ? WHERE user_id = ?",
                (now_s, user_id),
            )
            conn.execute(
                "UPDATE client_ip_accounts SET is_active = 0, last_logout_at = ? WHERE user_id = ? AND is_active = 1",
                (now_s, user_id),
            )
            conn.execute(
                "UPDATE client_login_histories SET status = 'logged_out', logout_at = ? WHERE user_id = ? AND status = 'active'",
                (now_s, user_id),
            )

        conn.commit()
        updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        add_audit_log(
            current_user["username"],
            "UPDATE_USER",
            f"Cập nhật nhân sự {row['username']} ({new_full_name}) - Trạng thái: {'Hoạt động' if new_active else 'Đã khóa'}",
            "SUCCESS",
            extract_client_ip(request),
        )
        return _serialize_user_for_admin(conn, updated)
    finally:
        conn.close()


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_ORG_USER_MANAGE")),
):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Không thể tự xóa tài khoản đang đăng nhập của chính mình")

    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")

        if (row["role"] or "").lower() == "admin":
            if not current_user.get("is_admin"):
                raise HTTPException(status_code=403, detail="Chỉ Admin mới được xóa tài khoản Admin")
            other_admins = conn.execute(
                "SELECT COUNT(*) AS cnt FROM users WHERE LOWER(role) = 'admin' AND is_active = 1 AND id != ?",
                (user_id,),
            ).fetchone()["cnt"]
            if other_admins == 0:
                raise HTTPException(status_code=400, detail="Không thể xóa tài khoản Admin hoạt động cuối cùng")

        conn.execute("UPDATE client_sessions SET user_id = NULL WHERE user_id = ?", (user_id,))
        conn.execute("UPDATE client_sessions SET last_user_id = NULL WHERE last_user_id = ?", (user_id,))
        conn.execute("UPDATE client_sessions SET blocked_by_id = NULL WHERE blocked_by_id = ?", (user_id,))
        conn.execute("DELETE FROM user_department WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM user_permissions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM client_ip_accounts WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM client_login_histories WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()

        add_audit_log(
            current_user["username"],
            "DELETE_USER",
            f"Xóa vĩnh viễn tài khoản: {row['username']} ({row['full_name']})",
            "SUCCESS",
            extract_client_ip(request),
        )
        return {"success": True, "message": f"Đã xóa tài khoản '{row['username']}' ({row['full_name']})"}
    finally:
        conn.close()


# ─── MA TRẬN PHÂN QUYỀN 3 TẦNG (A ∪ B ∪ C) CỦA NGƯỜI DÙNG ────────────────────

@router.get("/{user_id}/permission-matrix")
@router.get("/{user_id}/permissions")
def get_user_permission_matrix(
    user_id: int,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_PERMISSION_MANAGE", "PERM_ORG_USER_MANAGE")
    ),
):
    conn = get_conn()
    try:
        u_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not u_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")

        user_dict = dict(u_row)
        depts = conn.execute(
            """
            SELECT d.id, d.name, d.name_en
            FROM departments d
            JOIN user_department ud ON ud.department_id = d.id
            WHERE ud.user_id = ? AND d.is_active = 1
            ORDER BY d.id ASC
            """,
            (user_id,),
        ).fetchall()

        # 1. Tầng A: Quyền từ Khoa / Phòng
        dept_perms = []
        dept_perm_ids = set()
        for d in depts:
            p_rows = conn.execute(
                """
                SELECT p.id, p.perm_code, p.perm_name, p.module, p.group_name
                FROM permissions p
                JOIN department_permissions dp ON dp.permission_id = p.id
                WHERE dp.department_id = ?
                ORDER BY p.sort_order ASC
                """,
                (d["id"],),
            ).fetchall()
            for p in p_rows:
                if p["id"] not in dept_perm_ids:
                    dept_perm_ids.add(p["id"])
                    dept_perms.append(
                        {
                            "id": p["id"],
                            "perm_code": p["perm_code"],
                            "perm_name": p["perm_name"],
                            "module": p["module"],
                            "group_name": p["group_name"],
                            "source": "DEPARTMENT",
                            "department_name": d["name"],
                        }
                    )

        # 2. Tầng B: Quyền từ Chức vụ (loại trừ trùng với Tầng A)
        pos_perms = []
        pos_perm_ids = set()
        pos_name = None
        if user_dict.get("position_id"):
            pos_row = conn.execute(
                "SELECT id, name, is_active FROM positions WHERE id = ?",
                (user_dict["position_id"],),
            ).fetchone()
            if pos_row and int(pos_row["is_active"]):
                pos_name = pos_row["name"]
                p_rows = conn.execute(
                    """
                    SELECT p.id, p.perm_code, p.perm_name, p.module, p.group_name
                    FROM permissions p
                    JOIN position_permissions pp ON pp.permission_id = p.id
                    WHERE pp.position_id = ?
                    ORDER BY p.sort_order ASC
                    """,
                    (pos_row["id"],),
                ).fetchall()
                for p in p_rows:
                    if p["id"] not in dept_perm_ids and p["id"] not in pos_perm_ids:
                        pos_perm_ids.add(p["id"])
                        pos_perms.append(
                            {
                                "id": p["id"],
                                "perm_code": p["perm_code"],
                                "perm_name": p["perm_name"],
                                "module": p["module"],
                                "group_name": p["group_name"],
                                "source": "POSITION",
                                "position_name": pos_name,
                            }
                        )

        # 3. Tầng C: Quyền riêng Cá nhân (loại trừ trùng với A và B)
        indiv_perms = []
        indiv_perm_ids = set()
        p_rows = conn.execute(
            """
            SELECT p.id, p.perm_code, p.perm_name, p.module, p.group_name
            FROM permissions p
            JOIN user_permissions up ON up.permission_id = p.id
            WHERE up.user_id = ? AND up.is_granted = 1
            ORDER BY p.sort_order ASC
            """,
            (user_id,),
        ).fetchall()
        for p in p_rows:
            if p["id"] not in dept_perm_ids and p["id"] not in pos_perm_ids and p["id"] not in indiv_perm_ids:
                indiv_perm_ids.add(p["id"])
                indiv_perms.append(
                    {
                        "id": p["id"],
                        "perm_code": p["perm_code"],
                        "perm_name": p["perm_name"],
                        "module": p["module"],
                        "group_name": p["group_name"],
                        "source": "USER_DIRECT",
                    }
                )

        effective_codes = get_user_effective_permissions(conn, user_dict)
        is_adm = (user_dict.get("role") or "").lower() == "admin"

        return {
            "user_id": user_id,
            "username": user_dict["username"],
            "full_name": user_dict["full_name"],
            "cchn": user_dict.get("cchn") or "",
            "role": (user_dict.get("role") or "staff").lower(),
            "is_admin": is_adm,
            "permission_level": 0 if is_adm else 1,
            "position_id": user_dict.get("position_id"),
            "position_name": pos_name,
            "department_names": [d["name"] for d in depts],
            "department": dept_perms,
            "position": pos_perms,
            "individual": indiv_perms,
            "department_permissions": [p["perm_code"] for p in dept_perms],
            "position_permissions": [p["perm_code"] for p in pos_perms],
            "direct_permissions": [p["perm_code"] for p in indiv_perms],
            "effectiveCodes": effective_codes,
            "effective_permissions": effective_codes,
        }
    finally:
        conn.close()


@router.put("/{user_id}/permissions")
def update_user_permissions(
    user_id: int,
    body: UserPermissionsUpdateIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_PERMISSION_MANAGE", "PERM_ORG_USER_MANAGE")
    ),
):
    conn = get_conn()
    try:
        u_row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not u_row:
            raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")

        # Thu thập quyền Tầng A
        dept_rows = conn.execute(
            """
            SELECT dp.permission_id
            FROM department_permissions dp
            JOIN departments d ON d.id = dp.department_id
            JOIN user_department ud ON ud.department_id = d.id
            WHERE ud.user_id = ? AND d.is_active = 1
            """,
            (user_id,),
        ).fetchall()
        dept_perm_ids = {r["permission_id"] for r in dept_rows}

        # Thu thập quyền Tầng B
        pos_perm_ids = set()
        if u_row["position_id"]:
            pos_rows = conn.execute(
                """
                SELECT pp.permission_id
                FROM position_permissions pp
                JOIN positions p ON p.id = pp.position_id
                WHERE pp.position_id = ? AND p.is_active = 1
                """,
                (u_row["position_id"],),
            ).fetchall()
            pos_perm_ids = {r["permission_id"] for r in pos_rows}

        inherited_ids = dept_perm_ids | pos_perm_ids

        requested_ids = set(body.permission_ids or [])
        if body.perm_codes is not None:
            clean_codes = [c.strip() for c in body.perm_codes if c and c.strip() and c not in ("0", "*")]
            if clean_codes:
                placeholders = ",".join(["?"] * len(clean_codes))
                p_rows = conn.execute(
                    f"SELECT id FROM permissions WHERE perm_code IN ({placeholders})",
                    clean_codes,
                ).fetchall()
                requested_ids.update(r["id"] for r in p_rows)

        # Chỉ lưu quyền ngoại lệ Tầng C = requested \ (A ∪ B)
        target_ids = requested_ids - inherited_ids

        conn.execute("DELETE FROM user_permissions WHERE user_id = ?", (user_id,))
        saved_cnt = 0
        for pid in sorted(target_ids):
            exists = conn.execute("SELECT id FROM permissions WHERE id = ?", (int(pid),)).fetchone()
            if exists:
                conn.execute(
                    "INSERT INTO user_permissions (user_id, permission_id, is_granted) VALUES (?, ?, 1)",
                    (user_id, int(pid)),
                )
                saved_cnt += 1

        conn.commit()
        add_audit_log(
            current_user["username"],
            "UPDATE_USER_PERMISSIONS",
            f"Cập nhật quyền cá nhân (Tầng C) cho '{u_row['username']}' ({saved_cnt} quyền riêng, {len(inherited_ids)} quyền thừa kế)",
            "SUCCESS",
            extract_client_ip(request),
        )
        return {
            "success": True,
            "message": f"Đã cập nhật phân quyền cho '{u_row['full_name']}'",
            "count": saved_cnt,
            "effective_count": len(inherited_ids | target_ids),
        }
    finally:
        conn.close()
