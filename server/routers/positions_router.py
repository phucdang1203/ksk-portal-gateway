import re
import unicodedata
import sqlite3
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel

from server.database.db import get_conn, now_vn_str, add_audit_log
from server.core.deps import (
    get_current_user,
    require_any_permission,
    extract_client_ip,
)

router = APIRouter(prefix="/api/positions", tags=["Danh mục Chức vụ"])


class PositionCreateIn(BaseModel):
    name: str
    code: Optional[str] = None
    department_id: Optional[int] = None
    description: Optional[str] = ""
    is_active: bool = True


class PositionUpdateIn(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    department_id: Optional[int] = None
    clear_department: bool = False
    description: Optional[str] = None
    is_active: Optional[bool] = None


class PositionPermissionsUpdateIn(BaseModel):
    permission_ids: Optional[List[int]] = None
    perm_codes: Optional[List[str]] = None


def _slugify_code(text: str) -> str:
    if not text:
        return ""
    s = text.replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_").upper()
    return s[:48]


def _serialize_position(conn: sqlite3.Connection, row: sqlite3.Row) -> Dict[str, Any]:
    pos_id = int(row["id"])
    dept_id = row["department_id"]
    dept_name = None
    dept_code = None
    dept_perm_codes: List[str] = []

    if dept_id:
        d = conn.execute("SELECT id, name, name_en FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if d:
            dept_name = d["name"]
            dept_code = d["name_en"] or ""
        dp_rows = conn.execute(
            """
            SELECT p.perm_code
            FROM permissions p
            JOIN department_permissions dp ON dp.permission_id = p.id
            WHERE dp.department_id = ?
            ORDER BY p.sort_order ASC
            """,
            (dept_id,),
        ).fetchall()
        dept_perm_codes = [r["perm_code"] for r in dp_rows]

    pp_rows = conn.execute(
        """
        SELECT p.perm_code
        FROM permissions p
        JOIN position_permissions pp ON pp.permission_id = p.id
        WHERE pp.position_id = ?
        ORDER BY p.sort_order ASC
        """,
        (pos_id,),
    ).fetchall()
    direct_codes = [r["perm_code"] for r in pp_rows if r["perm_code"] not in set(dept_perm_codes)]
    effective_codes = list(dict.fromkeys([*dept_perm_codes, *direct_codes]))

    user_cnt = conn.execute(
        "SELECT COUNT(*) AS cnt FROM users WHERE position_id = ? AND is_active = 1",
        (pos_id,),
    ).fetchone()["cnt"]

    return {
        "id": pos_id,
        "code": row["code"],
        "name": row["name"],
        "department_id": dept_id,
        "department_name": dept_name,
        "department_code": dept_code,
        "description": row["description"] or "",
        "is_active": bool(row["is_active"]),
        "user_count": user_cnt or 0,
        "direct_permission_count": len(direct_codes),
        "inherited_permission_count": len(dept_perm_codes),
        "effective_permission_count": len(effective_codes),
        "perm_codes": direct_codes,
        "effective_perm_codes": effective_codes,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("")
def list_positions(
    department_id: Optional[int] = Query(None),
    include_inactive: bool = Query(True),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    conn = get_conn()
    try:
        clauses = ["1=1"]
        params: List[Any] = []
        if not include_inactive:
            clauses.append("is_active = 1")
        if department_id is not None:
            if department_id == 0:
                clauses.append("department_id IS NULL")
            else:
                clauses.append("(department_id = ? OR department_id IS NULL)")
                params.append(department_id)

        sql = f"SELECT * FROM positions WHERE {' AND '.join(clauses)} ORDER BY is_active DESC, department_id ASC, name ASC"
        rows = conn.execute(sql, params).fetchall()
        return [_serialize_position(conn, r) for r in rows]
    finally:
        conn.close()


@router.post("")
def create_position(
    body: PositionCreateIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_POSITION_MANAGE", "PERM_ORG_USER_MANAGE")
    ),
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tên chức vụ không được để trống")

    conn = get_conn()
    try:
        dept_prefix = "BV"
        if body.department_id:
            dept = conn.execute("SELECT * FROM departments WHERE id = ?", (body.department_id,)).fetchone()
            if not dept:
                raise HTTPException(status_code=404, detail="Khoa/Phòng đã chọn không tồn tại")
            dept_prefix = _slugify_code(dept["name_en"] or dept["name"]) or f"DEPT{body.department_id}"

        raw_code = _slugify_code(body.code or "")
        if not raw_code:
            raw_code = f"{dept_prefix}_{_slugify_code(name)}"[:50]

        final_code = raw_code
        suffix = 2
        while conn.execute("SELECT id FROM positions WHERE UPPER(code) = UPPER(?)", (final_code,)).fetchone():
            if body.code and body.code.strip():
                raise HTTPException(status_code=400, detail=f"Mã chức vụ '{final_code}' đã tồn tại")
            final_code = f"{raw_code[:44]}_{suffix}"
            suffix += 1

        now = now_vn_str()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO positions (code, name, department_id, description, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                final_code,
                name,
                body.department_id if body.department_id else None,
                (body.description or "").strip(),
                1 if body.is_active else 0,
                now,
                now,
            ),
        )
        new_id = cur.lastrowid
        conn.commit()

        row = conn.execute("SELECT * FROM positions WHERE id = ?", (new_id,)).fetchone()
        add_audit_log(
            current_user["username"],
            "CREATE_POSITION",
            f"Thêm chức vụ mới: {name} ({final_code})",
            "SUCCESS",
            extract_client_ip(request),
        )
        return _serialize_position(conn, row)
    finally:
        conn.close()


@router.put("/{pos_id}")
def update_position(
    pos_id: int,
    body: PositionUpdateIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_POSITION_MANAGE", "PERM_ORG_USER_MANAGE")
    ),
):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM positions WHERE id = ?", (pos_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy chức vụ")

        new_name = body.name.strip() if body.name is not None else row["name"]
        if not new_name:
            raise HTTPException(status_code=400, detail="Tên chức vụ không được để trống")

        new_code = row["code"]
        if body.code is not None and body.code.strip():
            cand = _slugify_code(body.code)
            dup = conn.execute(
                "SELECT id FROM positions WHERE UPPER(code) = UPPER(?) AND id != ?",
                (cand, pos_id),
            ).fetchone()
            if dup:
                raise HTTPException(status_code=400, detail=f"Mã chức vụ '{cand}' đã tồn tại")
            new_code = cand

        new_dept_id = row["department_id"]
        if body.clear_department:
            new_dept_id = None
        elif body.department_id is not None:
            if body.department_id == 0:
                new_dept_id = None
            else:
                d = conn.execute("SELECT id FROM departments WHERE id = ?", (body.department_id,)).fetchone()
                if not d:
                    raise HTTPException(status_code=404, detail="Khoa/Phòng không tồn tại")
                new_dept_id = body.department_id

        new_desc = body.description.strip() if body.description is not None else (row["description"] or "")
        new_active = (1 if body.is_active else 0) if body.is_active is not None else int(row["is_active"])
        now = now_vn_str()

        conn.execute(
            """
            UPDATE positions
            SET code = ?, name = ?, department_id = ?, description = ?, is_active = ?, updated_at = ?
            WHERE id = ?
            """,
            (new_code, new_name, new_dept_id, new_desc, new_active, now, pos_id),
        )
        conn.commit()

        updated = conn.execute("SELECT * FROM positions WHERE id = ?", (pos_id,)).fetchone()
        add_audit_log(
            current_user["username"],
            "UPDATE_POSITION",
            f"Cập nhật chức vụ #{pos_id}: {new_name} ({new_code})",
            "SUCCESS",
            extract_client_ip(request),
        )
        return _serialize_position(conn, updated)
    finally:
        conn.close()


@router.delete("/{pos_id}")
def delete_position(
    pos_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_POSITION_MANAGE", "PERM_ORG_USER_MANAGE")
    ),
):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM positions WHERE id = ?", (pos_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy chức vụ")

        u_cnt = conn.execute("SELECT COUNT(*) AS cnt FROM users WHERE position_id = ?", (pos_id,)).fetchone()["cnt"]
        if u_cnt > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Chức vụ '{row['name']}' đang gắn với {u_cnt} nhân sự. Vui lòng chuyển chức vụ của nhân sự trước khi xóa (hoặc chọn Khóa chức vụ).",
            )

        conn.execute("DELETE FROM position_permissions WHERE position_id = ?", (pos_id,))
        conn.execute("DELETE FROM positions WHERE id = ?", (pos_id,))
        conn.commit()

        add_audit_log(
            current_user["username"],
            "DELETE_POSITION",
            f"Xóa chức vụ: {row['name']} ({row['code']})",
            "SUCCESS",
            extract_client_ip(request),
        )
        return {"success": True, "message": f"Đã xóa chức vụ '{row['name']}'"}
    finally:
        conn.close()


@router.get("/{pos_id}/permissions")
def get_position_permissions(
    pos_id: int,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_PERMISSION_MANAGE", "PERM_ORG_POSITION_MANAGE", "PERM_ORG_USER_MANAGE")
    ),
):
    conn = get_conn()
    try:
        pos = conn.execute("SELECT * FROM positions WHERE id = ?", (pos_id,)).fetchone()
        if not pos:
            raise HTTPException(status_code=404, detail="Không tìm thấy chức vụ")

        dept_id = pos["department_id"]
        dept_name = None
        dept_perms = []
        dept_perm_ids = set()

        if dept_id:
            d = conn.execute("SELECT name FROM departments WHERE id = ?", (dept_id,)).fetchone()
            if d:
                dept_name = d["name"]
            d_rows = conn.execute(
                """
                SELECT p.id, p.perm_code, p.perm_name, p.module, p.group_name
                FROM permissions p
                JOIN department_permissions dp ON dp.permission_id = p.id
                WHERE dp.department_id = ?
                ORDER BY p.sort_order ASC
                """,
                (dept_id,),
            ).fetchall()
            dept_perms = [dict(r) for r in d_rows]
            dept_perm_ids = {p["id"] for p in dept_perms}

        p_rows = conn.execute(
            """
            SELECT p.id, p.perm_code, p.perm_name, p.module, p.group_name
            FROM permissions p
            JOIN position_permissions pp ON pp.permission_id = p.id
            WHERE pp.position_id = ?
            ORDER BY p.sort_order ASC
            """,
            (pos_id,),
        ).fetchall()
        direct_perms = [dict(r) for r in p_rows if r["id"] not in dept_perm_ids]

        return {
            "position_id": pos_id,
            "position_name": pos["name"],
            "position_code": pos["code"],
            "department_id": dept_id,
            "department_name": dept_name,
            "department_permission_ids": [p["id"] for p in dept_perms],
            "department_perm_codes": [p["perm_code"] for p in dept_perms],
            "department_permissions": dept_perms,
            "permission_ids": [p["id"] for p in direct_perms],
            "perm_codes": [p["perm_code"] for p in direct_perms],
            "permissions": direct_perms,
            "effective_perm_codes": [p["perm_code"] for p in dept_perms] + [p["perm_code"] for p in direct_perms],
        }
    finally:
        conn.close()


@router.put("/{pos_id}/permissions")
def update_position_permissions(
    pos_id: int,
    body: PositionPermissionsUpdateIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_PERMISSION_MANAGE", "PERM_ORG_POSITION_MANAGE", "PERM_ORG_USER_MANAGE")
    ),
):
    conn = get_conn()
    try:
        pos = conn.execute("SELECT * FROM positions WHERE id = ?", (pos_id,)).fetchone()
        if not pos:
            raise HTTPException(status_code=404, detail="Không tìm thấy chức vụ")

        dept_perm_ids = set()
        if pos["department_id"]:
            d_rows = conn.execute(
                "SELECT permission_id FROM department_permissions WHERE department_id = ?",
                (pos["department_id"],),
            ).fetchall()
            dept_perm_ids = {r["permission_id"] for r in d_rows}

        requested_ids = set(body.permission_ids or [])
        if body.perm_codes is not None:
            clean_codes = [c.strip() for c in body.perm_codes if c and c.strip()]
            if clean_codes:
                placeholders = ",".join(["?"] * len(clean_codes))
                p_rows = conn.execute(
                    f"SELECT id FROM permissions WHERE perm_code IN ({placeholders})",
                    clean_codes,
                ).fetchall()
                requested_ids.update(r["id"] for r in p_rows)

        # Chỉ lưu quyền đặc thù Tầng B (loại bỏ trùng với Tầng A của Khoa/Phòng)
        target_ids = requested_ids - dept_perm_ids

        conn.execute("DELETE FROM position_permissions WHERE position_id = ?", (pos_id,))
        saved_count = 0
        for pid in sorted(target_ids):
            exists = conn.execute("SELECT id FROM permissions WHERE id = ?", (int(pid),)).fetchone()
            if exists:
                conn.execute(
                    "INSERT OR IGNORE INTO position_permissions (position_id, permission_id) VALUES (?, ?)",
                    (pos_id, int(pid)),
                )
                saved_count += 1

        conn.commit()
        add_audit_log(
            current_user["username"],
            "UPDATE_POSITION_PERMISSIONS",
            f"Cập nhật quyền Tầng B cho chức vụ '{pos['name']}' ({saved_count} quyền riêng, {len(dept_perm_ids)} quyền kế thừa Khoa/Phòng)",
            "SUCCESS",
            extract_client_ip(request),
        )
        return {
            "success": True,
            "message": f"Đã cập nhật phân quyền cho chức vụ '{pos['name']}'",
            "direct_count": saved_count,
            "inherited_count": len(dept_perm_ids),
            "effective_count": len(dept_perm_ids | target_ids),
        }
    finally:
        conn.close()
