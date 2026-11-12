import sqlite3
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel

from server.database.db import get_conn, now_vn_str, add_audit_log, SYSTEM_DEPT_NAMES
from server.core.deps import (
    get_current_user,
    require_permission,
    require_any_permission,
    extract_client_ip,
)

router = APIRouter(prefix="/api/departments", tags=["Khoa / Phòng"])


class DepartmentCreateIn(BaseModel):
    name: str
    name_en: Optional[str] = ""
    description: Optional[str] = ""


class DepartmentUpdateIn(BaseModel):
    name: Optional[str] = None
    name_en: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class DepartmentPermissionsUpdateIn(BaseModel):
    permission_ids: Optional[List[int]] = None
    perm_codes: Optional[List[str]] = None


def _serialize_department(conn: sqlite3.Connection, row: sqlite3.Row) -> Dict[str, Any]:
    dept_id = int(row["id"])
    members_rows = conn.execute(
        """
        SELECT u.id, u.username, u.full_name, u.role, u.cchn, u.is_active,
               p.name AS position_name
        FROM users u
        JOIN user_department ud ON ud.user_id = u.id
        LEFT JOIN positions p ON p.id = u.position_id
        WHERE ud.department_id = ?
        ORDER BY CASE WHEN u.role = 'truong_phong' THEN 0 ELSE 1 END, u.full_name ASC
        """,
        (dept_id,),
    ).fetchall()

    members = [
        {
            "id": m["id"],
            "username": m["username"],
            "full_name": m["full_name"],
            "role": (m["role"] or "staff").lower(),
            "cchn": m["cchn"] or "",
            "position_name": m["position_name"],
            "is_active": bool(m["is_active"]),
        }
        for m in members_rows
    ]
    active_members = [m for m in members if m["is_active"]]
    head_user = next((m for m in active_members if m["role"] == "truong_phong"), None)

    perm_rows = conn.execute(
        """
        SELECT p.id, p.perm_code, p.perm_name
        FROM permissions p
        JOIN department_permissions dp ON dp.permission_id = p.id
        WHERE dp.department_id = ?
        ORDER BY p.sort_order ASC
        """,
        (dept_id,),
    ).fetchall()
    perm_codes = [p["perm_code"] for p in perm_rows]

    pos_cnt = conn.execute(
        "SELECT COUNT(*) AS cnt FROM positions WHERE department_id = ? AND is_active = 1",
        (dept_id,),
    ).fetchone()["cnt"]

    return {
        "id": dept_id,
        "name": row["name"],
        "name_en": row["name_en"] or "",
        "description": row["description"] or "",
        "is_active": bool(row["is_active"]),
        "is_system": row["name"] in SYSTEM_DEPT_NAMES,
        "created_at": row["created_at"],
        "member_count": len(active_members),
        "total_member_count": len(members),
        "members": members,
        "head_user": head_user,
        "head_of_department_id": head_user["id"] if head_user else None,
        "head_of_department_name": head_user["full_name"] if head_user else None,
        "position_count": pos_cnt or 0,
        "permission_count": len(perm_codes),
        "perm_codes": perm_codes,
    }


@router.get("")
def list_departments(
    include_inactive: bool = Query(False),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    conn = get_conn()
    try:
        if include_inactive:
            rows = conn.execute("SELECT * FROM departments ORDER BY is_active DESC, id ASC").fetchall()
        else:
            rows = conn.execute("SELECT * FROM departments WHERE is_active = 1 ORDER BY id ASC").fetchall()
        return [_serialize_department(conn, r) for r in rows]
    finally:
        conn.close()


@router.post("")
def create_department(
    body: DepartmentCreateIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_ORG_DEPT_MANAGE")),
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tên Khoa/Phòng không được để trống")

    name_en = (body.name_en or "").strip().upper()
    desc = (body.description or "").strip()
    now = now_vn_str()

    conn = get_conn()
    try:
        dup = conn.execute(
            "SELECT id, is_active FROM departments WHERE LOWER(name) = LOWER(?)",
            (name,),
        ).fetchone()
        if dup:
            status_note = " (đang ở mục Đã khóa)" if not dup["is_active"] else ""
            raise HTTPException(status_code=400, detail=f"Khoa/Phòng '{name}' đã tồn tại{status_note}")

        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO departments (name, name_en, description, is_active, created_at)
            VALUES (?, ?, ?, 1, ?)
            """,
            (name, name_en, desc, now),
        )
        new_id = cur.lastrowid
        conn.commit()

        row = conn.execute("SELECT * FROM departments WHERE id = ?", (new_id,)).fetchone()
        add_audit_log(
            current_user["username"],
            "CREATE_DEPARTMENT",
            f"Thêm Khoa/Phòng mới: {name} ({name_en})",
            "SUCCESS",
            extract_client_ip(request),
        )
        return _serialize_department(conn, row)
    finally:
        conn.close()


@router.put("/{dept_id}")
def update_department(
    dept_id: int,
    body: DepartmentUpdateIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_ORG_DEPT_MANAGE")),
):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy Khoa/Phòng")

        is_sys = row["name"] in SYSTEM_DEPT_NAMES
        new_name = row["name"]
        if body.name is not None:
            cand = body.name.strip()
            if not cand:
                raise HTTPException(status_code=400, detail="Tên Khoa/Phòng không được để trống")
            if is_sys and cand != row["name"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{row['name']}' là phòng hệ thống mặc định — không được phép đổi tên.",
                )
            dup = conn.execute(
                "SELECT id FROM departments WHERE LOWER(name) = LOWER(?) AND id != ?",
                (cand, dept_id),
            ).fetchone()
            if dup:
                raise HTTPException(status_code=400, detail=f"Tên Khoa/Phòng '{cand}' đã tồn tại")
            new_name = cand

        new_code = (body.name_en.strip().upper() if body.name_en is not None else (row["name_en"] or ""))
        new_desc = (body.description.strip() if body.description is not None else (row["description"] or ""))
        new_active = int(row["is_active"])
        if body.is_active is not None:
            if is_sys and not body.is_active:
                raise HTTPException(
                    status_code=400,
                    detail=f"Không thể khóa phòng hệ thống '{row['name']}'.",
                )
            new_active = 1 if body.is_active else 0

        conn.execute(
            """
            UPDATE departments
            SET name = ?, name_en = ?, description = ?, is_active = ?
            WHERE id = ?
            """,
            (new_name, new_code, new_desc, new_active, dept_id),
        )
        conn.commit()

        updated = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        add_audit_log(
            current_user["username"],
            "UPDATE_DEPARTMENT",
            f"Cập nhật Khoa/Phòng #{dept_id}: {new_name} ({new_code})",
            "SUCCESS",
            extract_client_ip(request),
        )
        return _serialize_department(conn, updated)
    finally:
        conn.close()


@router.delete("/{dept_id}")
def soft_delete_department(
    dept_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_ORG_DEPT_MANAGE")),
):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy Khoa/Phòng")
        if row["name"] in SYSTEM_DEPT_NAMES:
            raise HTTPException(status_code=400, detail=f"Không thể khóa phòng hệ thống '{row['name']}'.")

        conn.execute("UPDATE departments SET is_active = 0 WHERE id = ?", (dept_id,))
        conn.commit()

        add_audit_log(
            current_user["username"],
            "LOCK_DEPARTMENT",
            f"Khóa mềm Khoa/Phòng: {row['name']}",
            "SUCCESS",
            extract_client_ip(request),
        )
        return {"success": True, "message": f"Đã khóa Khoa/Phòng '{row['name']}'"}
    finally:
        conn.close()


@router.post("/{dept_id}/restore")
def restore_department(
    dept_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_ORG_DEPT_MANAGE")),
):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy Khoa/Phòng")

        conn.execute("UPDATE departments SET is_active = 1 WHERE id = ?", (dept_id,))
        conn.commit()

        updated = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        add_audit_log(
            current_user["username"],
            "RESTORE_DEPARTMENT",
            f"Khôi phục Khoa/Phòng: {row['name']}",
            "SUCCESS",
            extract_client_ip(request),
        )
        return _serialize_department(conn, updated)
    finally:
        conn.close()


@router.delete("/{dept_id}/purge")
def purge_department(
    dept_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_ORG_DEPT_MANAGE")),
):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy Khoa/Phòng")
        if row["name"] in SYSTEM_DEPT_NAMES:
            raise HTTPException(status_code=400, detail=f"Không thể xóa vĩnh viễn phòng hệ thống '{row['name']}'.")

        user_cnt = conn.execute(
            "SELECT COUNT(*) AS cnt FROM user_department WHERE department_id = ?",
            (dept_id,),
        ).fetchone()["cnt"]
        if user_cnt > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Khoa/Phòng '{row['name']}' vẫn còn {user_cnt} nhân sự trực thuộc. Vui lòng chuyển nhân sự sang phòng khác trước khi xóa vĩnh viễn.",
            )

        conn.execute("UPDATE positions SET department_id = NULL WHERE department_id = ?", (dept_id,))
        conn.execute("DELETE FROM department_permissions WHERE department_id = ?", (dept_id,))
        conn.execute("DELETE FROM departments WHERE id = ?", (dept_id,))
        conn.commit()

        add_audit_log(
            current_user["username"],
            "PURGE_DEPARTMENT",
            f"Xóa vĩnh viễn Khoa/Phòng: {row['name']}",
            "SUCCESS",
            extract_client_ip(request),
        )
        return {"success": True, "message": f"Đã xóa vĩnh viễn Khoa/Phòng '{row['name']}'"}
    finally:
        conn.close()


@router.get("/{dept_id}/permissions")
def get_department_permissions(
    dept_id: int,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_PERMISSION_MANAGE", "PERM_ORG_DEPT_MANAGE")
    ),
):
    conn = get_conn()
    try:
        dept = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not dept:
            raise HTTPException(status_code=404, detail="Không tìm thấy Khoa/Phòng")

        rows = conn.execute(
            """
            SELECT p.id, p.perm_code, p.perm_name, p.module, p.group_name, p.description, p.sort_order
            FROM permissions p
            JOIN department_permissions dp ON dp.permission_id = p.id
            WHERE dp.department_id = ?
            ORDER BY p.sort_order ASC
            """,
            (dept_id,),
        ).fetchall()
        perms = [dict(r) for r in rows]
        return {
            "department_id": dept_id,
            "department_name": dept["name"],
            "permission_ids": [p["id"] for p in perms],
            "perm_codes": [p["perm_code"] for p in perms],
            "permissions": perms,
        }
    finally:
        conn.close()


@router.put("/{dept_id}/permissions")
def update_department_permissions(
    dept_id: int,
    body: DepartmentPermissionsUpdateIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(
        require_any_permission("PERM_ORG_PERMISSION_MANAGE", "PERM_ORG_DEPT_MANAGE")
    ),
):
    conn = get_conn()
    try:
        dept = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not dept:
            raise HTTPException(status_code=404, detail="Không tìm thấy Khoa/Phòng")

        target_ids = set(body.permission_ids or [])
        if body.perm_codes is not None:
            clean_codes = [c.strip() for c in body.perm_codes if c and c.strip()]
            if clean_codes:
                placeholders = ",".join(["?"] * len(clean_codes))
                p_rows = conn.execute(
                    f"SELECT id FROM permissions WHERE perm_code IN ({placeholders})",
                    clean_codes,
                ).fetchall()
                target_ids.update(r["id"] for r in p_rows)

        conn.execute("DELETE FROM department_permissions WHERE department_id = ?", (dept_id,))
        valid_count = 0
        for pid in sorted(target_ids):
            exists = conn.execute("SELECT id FROM permissions WHERE id = ?", (int(pid),)).fetchone()
            if exists:
                conn.execute(
                    "INSERT OR IGNORE INTO department_permissions (department_id, permission_id) VALUES (?, ?)",
                    (dept_id, int(pid)),
                )
                valid_count += 1

        conn.commit()
        add_audit_log(
            current_user["username"],
            "UPDATE_DEPT_PERMISSIONS",
            f"Cập nhật quyền Tầng A cho Khoa/Phòng '{dept['name']}' ({valid_count} quyền)",
            "SUCCESS",
            extract_client_ip(request),
        )
        return {
            "success": True,
            "message": f"Đã lưu {valid_count} quyền mặc định cho '{dept['name']}'",
            "count": valid_count,
        }
    finally:
        conn.close()
