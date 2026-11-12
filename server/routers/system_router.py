import json
import time
import sqlite3
import datetime
from collections import defaultdict
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from server.database.db import get_conn, now_vn_str, add_audit_log
from server.core.deps import (
    get_current_user_optional,
    require_permission,
    extract_client_ip,
)

router = APIRouter(prefix="/api/system", tags=["Hệ thống & Máy trạm kết nối"])

SERVER_APP_VERSION = "1.0.3"
_HEARTBEAT_HITS: Dict[str, List[float]] = defaultdict(list)


class HeartbeatIn(BaseModel):
    session_uid: Optional[str] = None
    hostname: Optional[str] = None
    os_username: Optional[str] = None
    platform: Optional[str] = None
    os_release: Optional[str] = None
    arch: Optional[str] = None
    mac_address: Optional[str] = None
    cpu_info: Optional[str] = None
    total_ram_gb: Optional[float] = None
    os_uptime_hours: Optional[float] = None
    network_interfaces: Optional[List[Dict[str, Any]]] = None
    client_version: Optional[str] = None
    local_ip: Optional[str] = None


class BlockClientIpIn(BaseModel):
    reason: Optional[str] = "Quản trị viên chặn truy cập từ địa chỉ IP này"


def _parse_vn_dt(dt_str: Optional[str]) -> Optional[datetime.datetime]:
    if not dt_str:
        return None
    try:
        return datetime.datetime.strptime(dt_str[:19], "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def _parse_ver_tuple(v_str: Optional[str]) -> tuple:
    if not v_str:
        return (0, 0, 0)
    try:
        parts = v_str.strip().lstrip("vV").split("-")[0].split("+")[0].split(".")
        return tuple(int(p) for p in parts[:3])
    except Exception:
        return (0, 0, 0)


def upsert_workstation_connection(
    conn: sqlite3.Connection,
    *,
    client_ip: str,
    session_uid: Optional[str] = None,
    user_id: Optional[int] = None,
    user_known: bool = False,
    is_explicit_login: bool = False,
    is_explicit_logout: bool = False,
    hostname: Optional[str] = None,
    os_username: Optional[str] = None,
    platform: Optional[str] = None,
    os_release: Optional[str] = None,
    arch: Optional[str] = None,
    mac_address: Optional[str] = None,
    cpu_info: Optional[str] = None,
    total_ram_gb: Optional[float] = None,
    os_uptime_hours: Optional[float] = None,
    network_interfaces: Optional[List[Dict[str, Any]]] = None,
    user_agent: Optional[str] = None,
    client_version: Optional[str] = None,
) -> Dict[str, Any]:
    """Hợp nhất thông tin máy trạm theo khóa duy nhất client_ip (1 dòng / 1 IP)."""
    ip = (client_ip or "").strip() or "127.0.0.1"
    now_s = now_vn_str()
    now_dt = _parse_vn_dt(now_s) or datetime.datetime.now()

    ws = conn.execute("SELECT * FROM client_sessions WHERE client_ip = ?", (ip,)).fetchone()
    if not ws:
        suid = (session_uid or f"ip_{ip}")[:128]
        conn.execute(
            """
            INSERT INTO client_sessions (
                client_ip, session_uid, first_connected_at, last_heartbeat_at, is_online, is_blocked
            )
            VALUES (?, ?, ?, ?, 1, 0)
            """,
            (ip, suid, now_s, now_s),
        )
        ws = conn.execute("SELECT * FROM client_sessions WHERE client_ip = ?", (ip,)).fetchone()

    ws_d = dict(ws)

    # Non-destructive merge cho thông tin phần cứng & phiên bản
    suid_val = (session_uid or "").strip()[:128] or ws_d.get("session_uid") or f"ip_{ip}"
    host_val = (hostname or "").strip()[:120] or ws_d.get("hostname") or ""
    os_user_val = (os_username or "").strip()[:120] or ws_d.get("os_username") or ""
    plat_val = (platform or "").strip()[:120] or ws_d.get("platform") or ""
    os_rel_val = (os_release or "").strip()[:120] or ws_d.get("os_release") or ""
    arch_val = (arch or "").strip()[:40] or ws_d.get("arch") or ""
    mac_val = (mac_address or "").strip().upper()[:40] or ws_d.get("mac_address") or ""
    cpu_val = (cpu_info or "").strip()[:180] or ws_d.get("cpu_info") or ""
    ram_val = total_ram_gb if total_ram_gb is not None else ws_d.get("total_ram_gb")
    up_val = os_uptime_hours if os_uptime_hours is not None else ws_d.get("os_uptime_hours")
    ua_val = (user_agent or "").strip()[:250] or ws_d.get("user_agent") or ""
    ver_val = (client_version or "").strip()[:40] or ws_d.get("client_version") or ""

    net_json = ws_d.get("network_interfaces_json") or "[]"
    if network_interfaces is not None and isinstance(network_interfaces, list) and len(network_interfaces) > 0:
        try:
            net_json = json.dumps(network_interfaces, ensure_ascii=False)
        except Exception:
            pass

    conn.execute(
        """
        UPDATE client_sessions
        SET session_uid = ?,
            hostname = ?,
            os_username = ?,
            platform = ?,
            os_release = ?,
            arch = ?,
            mac_address = ?,
            cpu_info = ?,
            total_ram_gb = ?,
            os_uptime_hours = ?,
            network_interfaces_json = ?,
            user_agent = ?,
            client_version = ?,
            last_heartbeat_at = ?,
            is_online = 1
        WHERE client_ip = ?
        """,
        (
            suid_val,
            host_val,
            os_user_val,
            plat_val,
            os_rel_val,
            arch_val,
            mac_val,
            cpu_val,
            ram_val,
            up_val,
            net_json,
            ua_val,
            ver_val,
            now_s,
            ip,
        ),
    )

    # Nếu IP đang bị chặn: đóng toàn bộ phiên active trên IP này
    if int(ws_d.get("is_blocked") or 0) == 1:
        if ws_d.get("user_id") is not None:
            conn.execute(
                "UPDATE client_sessions SET last_user_id = user_id, user_id = NULL, last_logout_at = ? WHERE client_ip = ?",
                (now_s, ip),
            )
        conn.execute(
            "UPDATE client_login_histories SET status = 'blocked_ip', logout_at = ?, last_seen_at = ? WHERE client_ip = ? AND status = 'active'",
            (now_s, now_s, ip),
        )
        conn.execute(
            "UPDATE client_ip_accounts SET is_active = 0, last_logout_at = ? WHERE client_ip = ? AND is_active = 1",
            (now_s, ip),
        )
        return dict(conn.execute("SELECT * FROM client_sessions WHERE client_ip = ?", (ip,)).fetchone())

    # Trường hợp 1: Đăng xuất chủ động hoặc Heartbeat xác nhận đang ở Chế độ Chờ / Khách
    if is_explicit_logout or (user_known and user_id is None):
        if ws_d.get("user_id") is not None:
            conn.execute(
                "UPDATE client_sessions SET last_user_id = user_id, user_id = NULL, last_logout_at = ? WHERE client_ip = ?",
                (now_s, ip),
            )
        conn.execute(
            "UPDATE client_login_histories SET status = 'logged_out', logout_at = ?, last_seen_at = ? WHERE client_ip = ? AND status = 'active'",
            (now_s, now_s, ip),
        )
        conn.execute(
            "UPDATE client_ip_accounts SET is_active = 0, last_logout_at = ?, last_seen_at = ? WHERE client_ip = ? AND is_active = 1",
            (now_s, now_s, ip),
        )
        return dict(conn.execute("SELECT * FROM client_sessions WHERE client_ip = ?", (ip,)).fetchone())

    # Trường hợp 2: Có tài khoản đăng nhập hợp lệ trên IP này
    if user_id is not None:
        uid = int(user_id)
        # Đóng phiên active của tài khoản KHÁC trên cùng IP (switched_user)
        conn.execute(
            """
            UPDATE client_login_histories
            SET status = 'switched_user', logout_at = ?
            WHERE client_ip = ? AND user_id != ? AND status = 'active'
            """,
            (now_s, ip, uid),
        )
        conn.execute(
            """
            UPDATE client_ip_accounts
            SET is_active = 0, last_logout_at = ?
            WHERE client_ip = ? AND user_id != ? AND is_active = 1
            """,
            (now_s, ip, uid),
        )

        active_hist = conn.execute(
            """
            SELECT * FROM client_login_histories
            WHERE client_ip = ? AND user_id = ? AND status = 'active'
            ORDER BY id DESC LIMIT 1
            """,
            (ip, uid),
        ).fetchone()

        need_new_session = False
        if is_explicit_login:
            if active_hist:
                conn.execute(
                    "UPDATE client_login_histories SET status = 'session_expired', logout_at = ? WHERE id = ?",
                    (now_s, active_hist["id"]),
                )
            need_new_session = True
        elif not active_hist:
            need_new_session = True
        else:
            last_dt = _parse_vn_dt(active_hist["last_seen_at"])
            if last_dt and (now_dt - last_dt).total_seconds() > 900:
                conn.execute(
                    "UPDATE client_login_histories SET status = 'session_expired', logout_at = ? WHERE id = ?",
                    (active_hist["last_seen_at"], active_hist["id"]),
                )
                need_new_session = True

        acc = conn.execute(
            "SELECT * FROM client_ip_accounts WHERE client_ip = ? AND user_id = ?",
            (ip, uid),
        ).fetchone()
        if not acc:
            conn.execute(
                """
                INSERT INTO client_ip_accounts (
                    client_ip, user_id, is_active, login_count,
                    first_login_at, last_login_at, last_seen_at,
                    last_client_version, last_hostname, last_os_username
                )
                VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
                """,
                (ip, uid, now_s, now_s, now_s, ver_val, host_val, os_user_val),
            )
        else:
            inc = 1 if need_new_session else 0
            new_last_login = now_s if need_new_session else acc["last_login_at"]
            conn.execute(
                """
                UPDATE client_ip_accounts
                SET is_active = 1,
                    login_count = COALESCE(login_count, 0) + ?,
                    last_login_at = ?,
                    last_seen_at = ?,
                    last_client_version = CASE WHEN ? != '' THEN ? ELSE last_client_version END,
                    last_hostname = CASE WHEN ? != '' THEN ? ELSE last_hostname END,
                    last_os_username = CASE WHEN ? != '' THEN ? ELSE last_os_username END
                WHERE id = ?
                """,
                (inc, new_last_login, now_s, ver_val, ver_val, host_val, host_val, os_user_val, os_user_val, acc["id"]),
            )

        if need_new_session:
            conn.execute(
                """
                INSERT INTO client_login_histories (
                    client_ip, user_id, session_uid, hostname, os_username,
                    platform, mac_address, client_version, login_at, last_seen_at, status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
                """,
                (ip, uid, suid_val, host_val, os_user_val, plat_val, mac_val, ver_val, now_s, now_s),
            )
        elif active_hist:
            conn.execute(
                """
                UPDATE client_login_histories
                SET last_seen_at = ?,
                    hostname = CASE WHEN ? != '' THEN ? ELSE hostname END,
                    os_username = CASE WHEN ? != '' THEN ? ELSE os_username END,
                    client_version = CASE WHEN ? != '' THEN ? ELSE client_version END
                WHERE id = ?
                """,
                (now_s, host_val, host_val, os_user_val, os_user_val, ver_val, ver_val, active_hist["id"]),
            )

        conn.execute(
            """
            UPDATE client_sessions
            SET user_id = ?,
                last_user_id = ?,
                last_login_at = CASE WHEN ? = 1 OR last_login_at IS NULL THEN ? ELSE last_login_at END
            WHERE client_ip = ?
            """,
            (uid, uid, 1 if need_new_session else 0, now_s, ip),
        )

    return dict(conn.execute("SELECT * FROM client_sessions WHERE client_ip = ?", (ip,)).fetchone())


def _build_connected_clients_list(
    conn: sqlite3.Connection,
    target_ip: Optional[str] = None,
    include_full_history: bool = False,
) -> List[Dict[str, Any]]:
    now_s = now_vn_str()
    now_dt = _parse_vn_dt(now_s) or datetime.datetime.now()
    today_prefix = now_s[:10] + "%"

    if target_ip:
        sessions = conn.execute(
            "SELECT * FROM client_sessions WHERE client_ip = ? ORDER BY last_heartbeat_at DESC",
            (target_ip,),
        ).fetchall()
    else:
        sessions = conn.execute(
            "SELECT * FROM client_sessions ORDER BY last_heartbeat_at DESC"
        ).fetchall()

    if not sessions:
        return []

    ips = [s["client_ip"] for s in sessions if s["client_ip"]]
    ip_placeholders = ",".join(["?"] * len(ips))

    ip_accounts = conn.execute(
        f"""
        SELECT * FROM client_ip_accounts
        WHERE client_ip IN ({ip_placeholders})
        ORDER BY is_active DESC, last_login_at DESC
        """,
        ips,
    ).fetchall()

    accounts_by_ip: Dict[str, List[sqlite3.Row]] = defaultdict(list)
    all_user_ids = set()
    for s in sessions:
        if s["user_id"]:
            all_user_ids.add(int(s["user_id"]))
        if s["last_user_id"]:
            all_user_ids.add(int(s["last_user_id"]))
        if s["blocked_by_id"]:
            all_user_ids.add(int(s["blocked_by_id"]))
    for acc in ip_accounts:
        accounts_by_ip[acc["client_ip"]].append(acc)
        if acc["user_id"]:
            all_user_ids.add(int(acc["user_id"]))

    users_by_id: Dict[int, Dict[str, Any]] = {}
    if all_user_ids:
        uid_list = list(all_user_ids)
        u_ph = ",".join(["?"] * len(uid_list))
        u_rows = conn.execute(
            f"""
            SELECT u.*, p.name AS position_name
            FROM users u
            LEFT JOIN positions p ON p.id = u.position_id
            WHERE u.id IN ({u_ph})
            """,
            uid_list,
        ).fetchall()
        dept_rows = conn.execute(
            f"""
            SELECT ud.user_id, d.name
            FROM user_department ud
            JOIN departments d ON d.id = ud.department_id
            WHERE ud.user_id IN ({u_ph}) AND d.is_active = 1
            """,
            uid_list,
        ).fetchall()
        depts_map: Dict[int, List[str]] = defaultdict(list)
        for dr in dept_rows:
            depts_map[int(dr["user_id"])].append(dr["name"])

        for ur in u_rows:
            d_dict = dict(ur)
            d_dict["department_name"] = ", ".join(depts_map.get(int(ur["id"]), []))
            users_by_id[int(ur["id"])] = d_dict

    histories_by_ip_user: Dict[tuple, List[sqlite3.Row]] = defaultdict(list)
    if include_full_history and ips:
        h_rows = conn.execute(
            f"""
            SELECT * FROM client_login_histories
            WHERE client_ip IN ({ip_placeholders})
            ORDER BY login_at DESC, id DESC
            LIMIT 500
            """,
            ips,
        ).fetchall()
        for hr in h_rows:
            histories_by_ip_user[(hr["client_ip"], int(hr["user_id"]))].append(hr)

    # Thống kê nghiệp vụ KSK hôm nay theo username
    signed_today_by_user: Dict[str, int] = {}
    pushed_today_by_user: Dict[str, int] = {}
    for sr in conn.execute(
        "SELECT signed_by, COUNT(*) AS cnt FROM ksk_records WHERE signed_at LIKE ? AND signed_by IS NOT NULL GROUP BY signed_by",
        (today_prefix,),
    ).fetchall():
        signed_today_by_user[sr["signed_by"]] = sr["cnt"]

    for pr in conn.execute(
        "SELECT synced_by, COUNT(*) AS cnt FROM ksk_records WHERE synced_at LIKE ? AND sync_status = 'SYNCED' AND synced_by IS NOT NULL GROUP BY synced_by",
        (today_prefix,),
    ).fetchall():
        pushed_today_by_user[pr["synced_by"]] = pr["cnt"]

    server_ver_tuple = _parse_ver_tuple(SERVER_APP_VERSION)

    result = []
    for s in sessions:
        hb_dt = _parse_vn_dt(s["last_heartbeat_at"])
        diff_sec = (now_dt - hb_dt).total_seconds() if hb_dt else 999999
        is_online = diff_sec <= 60

        client_ver_tuple = _parse_ver_tuple(s["client_version"])
        is_outdated = client_ver_tuple < server_ver_tuple if s["client_version"] else False

        cur_user = users_by_id.get(int(s["user_id"])) if s["user_id"] else None
        ip_acc_list = accounts_by_ip.get(s["client_ip"], [])
        fallback_last_uid = int(s["last_user_id"]) if s["last_user_id"] else (int(ip_acc_list[0]["user_id"]) if ip_acc_list else None)
        last_user = users_by_id.get(fallback_last_uid) if fallback_last_uid else None

        blocked_by_user = users_by_id.get(int(s["blocked_by_id"])) if s["blocked_by_id"] else None
        blocked_by_name = (blocked_by_user["full_name"] or blocked_by_user["username"]) if blocked_by_user else None

        accounts_summary = []
        detailed_accounts = []
        for acc in ip_acc_list:
            u = users_by_id.get(int(acc["user_id"]))
            if not u:
                continue
            acc_is_active = bool(s["user_id"] == u["id"] and not int(s["is_blocked"] or 0))
            accounts_summary.append(
                {
                    "user_id": u["id"],
                    "username": u["username"],
                    "full_name": u["full_name"],
                    "cchn": u.get("cchn") or "",
                    "department_name": u.get("department_name") or "",
                    "position_name": u.get("position_name") or "",
                    "is_active": acc_is_active,
                    "login_count": acc["login_count"] or 1,
                    "last_login_at": acc["last_login_at"],
                    "last_seen_at": acc["last_seen_at"],
                }
            )

            if include_full_history:
                raw_hists = histories_by_ip_user.get((s["client_ip"], u["id"]), [])
                hist_items = []
                for h in raw_hists:
                    eff_status = h["status"]
                    if eff_status == "active" and not acc_is_active:
                        eff_status = "logged_out" if h["logout_at"] else "session_expired"
                    hist_items.append(
                        {
                            "id": h["id"],
                            "client_ip": h["client_ip"],
                            "user_id": u["id"],
                            "username": u["username"],
                            "full_name": u["full_name"],
                            "session_uid": h["session_uid"],
                            "hostname": h["hostname"] or s["hostname"],
                            "os_username": h["os_username"] or s["os_username"],
                            "platform": h["platform"] or s["platform"],
                            "mac_address": h["mac_address"] or s["mac_address"],
                            "client_version": h["client_version"] or acc["last_client_version"] or s["client_version"],
                            "login_at": h["login_at"],
                            "last_seen_at": h["last_seen_at"],
                            "logout_at": h["logout_at"],
                            "status": eff_status,
                        }
                    )
                detailed_accounts.append(
                    {
                        "id": acc["id"],
                        "client_ip": acc["client_ip"],
                        "user_id": u["id"],
                        "username": u["username"],
                        "full_name": u["full_name"],
                        "cchn": u.get("cchn") or "",
                        "role": (u.get("role") or "staff").lower(),
                        "position_name": u.get("position_name") or "",
                        "department_name": u.get("department_name") or "",
                        "is_active": acc_is_active,
                        "login_count": acc["login_count"] or max(1, len(hist_items)),
                        "first_login_at": acc["first_login_at"],
                        "last_login_at": acc["last_login_at"],
                        "last_seen_at": acc["last_seen_at"],
                        "last_logout_at": acc["last_logout_at"],
                        "last_client_version": acc["last_client_version"] or s["client_version"],
                        "last_hostname": acc["last_hostname"] or s["hostname"],
                        "last_os_username": acc["last_os_username"] or s["os_username"],
                        "login_history": hist_items,
                    }
                )

        net_ifaces = []
        if s["network_interfaces_json"]:
            try:
                parsed = json.loads(s["network_interfaces_json"])
                if isinstance(parsed, list):
                    net_ifaces = parsed
            except Exception:
                pass

        active_uname = cur_user["username"] if cur_user else (last_user["username"] if last_user else "")
        signed_cnt = signed_today_by_user.get(active_uname, 0) if active_uname else 0
        pushed_cnt = pushed_today_by_user.get(active_uname, 0) if active_uname else 0

        item = {
            "session_uid": s["session_uid"] or s["client_ip"],
            "client_ip": s["client_ip"],
            "hostname": s["hostname"] or "",
            "os_username": s["os_username"] or "",
            "platform": s["platform"] or "",
            "os_release": s["os_release"] or "",
            "arch": s["arch"] or "",
            "mac_address": s["mac_address"] or "",
            "cpu_info": s["cpu_info"] or "",
            "total_ram_gb": s["total_ram_gb"],
            "os_uptime_hours": s["os_uptime_hours"],
            "network_interfaces": net_ifaces,
            "user_agent": s["user_agent"] or "",
            "client_version": s["client_version"] or "",
            "user_id": s["user_id"],
            "username": cur_user["username"] if cur_user else None,
            "full_name": cur_user["full_name"] if cur_user else None,
            "cchn": cur_user.get("cchn") if cur_user else None,
            "department_name": cur_user.get("department_name") if cur_user else None,
            "position_name": cur_user.get("position_name") if cur_user else None,
            "last_user_id": fallback_last_uid,
            "last_username": last_user["username"] if last_user else None,
            "last_full_name": last_user["full_name"] if last_user else None,
            "last_department_name": last_user.get("department_name") if last_user else None,
            "last_login_at": s["last_login_at"],
            "last_logout_at": s["last_logout_at"],
            "account_count": len(accounts_summary),
            "accounts_summary": accounts_summary,
            "first_connected_at": s["first_connected_at"],
            "last_heartbeat_at": s["last_heartbeat_at"],
            "is_online": is_online,
            "is_outdated": is_outdated,
            "is_blocked": bool(int(s["is_blocked"] or 0)),
            "blocked_reason": s["blocked_reason"],
            "blocked_at": s["blocked_at"],
            "blocked_by_name": blocked_by_name,
            "signed_count_today": signed_cnt,
            "pushed_count_today": pushed_cnt,
        }
        if include_full_history:
            item["accounts"] = detailed_accounts
        result.append(item)

    result.sort(key=lambda x: (1 if x["is_online"] else 0, x["last_heartbeat_at"] or ""), reverse=True)
    return result


@router.post("/heartbeat")
def client_heartbeat(
    body: HeartbeatIn,
    request: Request,
    current_user: Optional[Dict[str, Any]] = Depends(get_current_user_optional),
):
    client_ip = extract_client_ip(request)
    # Nếu chạy localhost dev mà Electron gửi được IP LAN thật của máy, vẫn tôn trọng socket IP
    # hoặc dùng local_ip khi socket là loopback nếu cần nhận diện LAN
    now_mono = time.monotonic()
    hits = _HEARTBEAT_HITS[client_ip]
    hits[:] = [t for t in hits if now_mono - t < 60]
    if len(hits) > 120:
        raise HTTPException(status_code=429, detail="Tần suất heartbeat quá giới hạn")
    hits.append(now_mono)

    user_agent = request.headers.get("user-agent") if request else ""
    conn = get_conn()
    try:
        ws = upsert_workstation_connection(
            conn,
            client_ip=client_ip,
            session_uid=body.session_uid,
            user_id=current_user["id"] if current_user else None,
            user_known=True,
            hostname=body.hostname,
            os_username=body.os_username,
            platform=body.platform,
            os_release=body.os_release,
            arch=body.arch,
            mac_address=body.mac_address,
            cpu_info=body.cpu_info,
            total_ram_gb=body.total_ram_gb,
            os_uptime_hours=body.os_uptime_hours,
            network_interfaces=body.network_interfaces,
            user_agent=user_agent,
            client_version=body.client_version,
        )
        conn.commit()
    finally:
        conn.close()

    if ws and int(ws.get("is_blocked") or 0) == 1:
        raise HTTPException(
            status_code=403,
            detail=f"Địa chỉ IP máy trạm ({client_ip}) đã bị Quản trị viên chặn truy cập. Lý do: {ws.get('blocked_reason') or 'Chặn bởi Quản trị viên'}",
            headers={"X-Block-Code": "IP_BLOCKED"},
        )

    # Nếu máy trạm có gửi kèm Bearer token nhưng phiên đã bị Admin đăng xuất từ xa hoặc tài khoản bị khóa
    auth_header = (request.headers.get("authorization") or "") if request else ""
    if auth_header.startswith("Bearer ") and auth_header[7:].strip() and current_user is None:
        raise HTTPException(
            status_code=401,
            detail="Phiên đăng nhập của tài khoản trên thiết bị này đã được Quản trị viên đăng xuất hoặc hết hiệu lực. Vui lòng đăng nhập lại.",
        )

    return {
        "status": "ok",
        "server_version": SERVER_APP_VERSION,
        "client_ip": client_ip,
    }


@router.get("/connected-clients")
def get_connected_clients(
    current_user: Dict[str, Any] = Depends(require_permission("PERM_SYS_CLIENTS_MANAGE")),
):
    conn = get_conn()
    try:
        return _build_connected_clients_list(conn, target_ip=None, include_full_history=False)
    finally:
        conn.close()


@router.get("/connected-clients/{client_ip}/detail")
def get_connected_client_detail(
    client_ip: str,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_SYS_CLIENTS_MANAGE")),
):
    ip = (client_ip or "").strip()
    conn = get_conn()
    try:
        items = _build_connected_clients_list(conn, target_ip=ip, include_full_history=True)
        if not items:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy máy trạm với địa chỉ IP {ip}")
        return items[0]
    finally:
        conn.close()


@router.post("/connected-clients/{client_ip}/block")
def block_connected_client_ip(
    client_ip: str,
    body: BlockClientIpIn,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_SYS_CLIENTS_MANAGE")),
):
    target_ip = (client_ip or "").strip()
    caller_ip = extract_client_ip(request)

    if target_ip in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=400, detail="Không thể chặn địa chỉ IP máy chủ nội bộ (127.0.0.1).")
    if caller_ip and target_ip == caller_ip:
        raise HTTPException(
            status_code=400,
            detail=f"Bạn đang thao tác từ chính địa chỉ IP {target_ip}. Không thể tự chặn IP máy mình.",
        )

    conn = get_conn()
    try:
        ws = conn.execute("SELECT * FROM client_sessions WHERE client_ip = ?", (target_ip,)).fetchone()
        if not ws:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy máy trạm với địa chỉ IP {target_ip}")

        now_s = now_vn_str()
        reason = (body.reason or "").strip() or "Quản trị viên chặn truy cập từ địa chỉ IP này"

        conn.execute(
            """
            UPDATE client_sessions
            SET is_blocked = 1,
                blocked_reason = ?,
                blocked_at = ?,
                blocked_by_id = ?,
                last_user_id = CASE WHEN user_id IS NOT NULL THEN user_id ELSE last_user_id END,
                user_id = NULL,
                last_logout_at = CASE WHEN user_id IS NOT NULL THEN ? ELSE last_logout_at END
            WHERE client_ip = ?
            """,
            (reason, now_s, current_user["id"], now_s, target_ip),
        )
        conn.execute(
            "UPDATE client_login_histories SET status = 'blocked_ip', logout_at = ?, last_seen_at = ? WHERE client_ip = ? AND status = 'active'",
            (now_s, now_s, target_ip),
        )
        conn.execute(
            "UPDATE client_ip_accounts SET is_active = 0, last_logout_at = ? WHERE client_ip = ? AND is_active = 1",
            (now_s, target_ip),
        )
        if ws["session_uid"]:
            conn.execute(
                "INSERT OR REPLACE INTO revoked_sessions (session_uid, revoked_at) VALUES (?, ?)",
                (ws["session_uid"], now_s),
            )
        conn.commit()

        add_audit_log(
            current_user["username"],
            "BLOCK_CLIENT_IP",
            f"Chặn địa chỉ IP máy trạm {target_ip} - Lý do: {reason}",
            "SUCCESS",
            caller_ip,
        )
        return _build_connected_clients_list(conn, target_ip=target_ip, include_full_history=True)[0]
    finally:
        conn.close()


@router.post("/connected-clients/{client_ip}/unblock")
def unblock_connected_client_ip(
    client_ip: str,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_SYS_CLIENTS_MANAGE")),
):
    target_ip = (client_ip or "").strip()
    conn = get_conn()
    try:
        ws = conn.execute("SELECT * FROM client_sessions WHERE client_ip = ?", (target_ip,)).fetchone()
        if not ws:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy máy trạm với địa chỉ IP {target_ip}")

        conn.execute(
            """
            UPDATE client_sessions
            SET is_blocked = 0, blocked_reason = NULL, blocked_at = NULL, blocked_by_id = NULL
            WHERE client_ip = ?
            """,
            (target_ip,),
        )
        if ws["session_uid"]:
            conn.execute("DELETE FROM revoked_sessions WHERE session_uid = ?", (ws["session_uid"],))
        conn.commit()

        add_audit_log(
            current_user["username"],
            "UNBLOCK_CLIENT_IP",
            f"Bỏ chặn địa chỉ IP máy trạm {target_ip}",
            "SUCCESS",
            extract_client_ip(request),
        )
        return _build_connected_clients_list(conn, target_ip=target_ip, include_full_history=True)[0]
    finally:
        conn.close()


@router.post("/connected-clients/{client_ip}/accounts/{user_id}/logout")
def logout_connected_client_account(
    client_ip: str,
    user_id: int,
    request: Request,
    current_user: Dict[str, Any] = Depends(require_permission("PERM_SYS_CLIENTS_MANAGE")),
):
    target_ip = (client_ip or "").strip()
    conn = get_conn()
    try:
        ws = conn.execute("SELECT * FROM client_sessions WHERE client_ip = ?", (target_ip,)).fetchone()
        if not ws:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy máy trạm với địa chỉ IP {target_ip}")

        now_s = now_vn_str()
        if ws["user_id"] == user_id:
            conn.execute(
                "UPDATE client_sessions SET last_user_id = user_id, user_id = NULL, last_logout_at = ? WHERE client_ip = ?",
                (now_s, target_ip),
            )

        conn.execute(
            "UPDATE client_ip_accounts SET is_active = 0, last_logout_at = ? WHERE client_ip = ? AND user_id = ?",
            (now_s, target_ip, user_id),
        )
        conn.execute(
            """
            UPDATE client_login_histories
            SET status = 'logged_out', logout_at = ?, last_seen_at = ?
            WHERE client_ip = ? AND user_id = ? AND status = 'active'
            """,
            (now_s, now_s, target_ip, user_id),
        )

        revoke_key = f"ip:{target_ip}:u:{int(user_id)}"[:64]
        conn.execute(
            "INSERT OR REPLACE INTO revoked_sessions (session_uid, revoked_at) VALUES (?, ?)",
            (revoke_key, now_s),
        )
        conn.commit()

        u_row = conn.execute("SELECT username, full_name FROM users WHERE id = ?", (user_id,)).fetchone()
        u_label = f"{u_row['username']} ({u_row['full_name']})" if u_row else f"user#{user_id}"
        add_audit_log(
            current_user["username"],
            "REMOTE_LOGOUT_ACCOUNT",
            f"Đăng xuất từ xa tài khoản {u_label} khỏi máy trạm IP {target_ip}",
            "SUCCESS",
            extract_client_ip(request),
        )
        return _build_connected_clients_list(conn, target_ip=target_ip, include_full_history=True)[0]
    finally:
        conn.close()
