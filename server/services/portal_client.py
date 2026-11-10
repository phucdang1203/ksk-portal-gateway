"""
Dịch vụ Đẩy gói tin Khám Sức Khỏe ĐÃ KÝ SỐ ĐIỆN TỬ BỆNH VIỆN lên Cổng Quốc gia
(Trục EMRHub Bộ Y Tế theo QĐ 2062/QĐ-BYT & Cổng Liên thông Đề án 06).
"""

import time
import json
import datetime
import requests
from typing import Dict, Any
from server.database.db import get_all_configs, get_conn, now_vn_str


class NationalPortalClient:
    def __init__(self):
        self.cached_token = None

    def _get_portal_config(self) -> Dict[str, Any]:
        cfg = get_all_configs()
        return cfg.get("portal", {})

    def _get_base_url(self, portal_cfg: Dict[str, Any]) -> str:
        env = portal_cfg.get("env", "sandbox")
        if env == "prod":
            return (portal_cfg.get("prod_url") or "https://api.emrhub.vn").rstrip("/")
        return (portal_cfg.get("sandbox_url") or "https://api-sandbox.emrhub.vn").rstrip("/")

    def push_signed_envelope(
        self,
        envelope: Dict[str, Any],
        package_id: str,
        batch_id: int,
        record_count: int,
        sender_username: str = "admin",
    ) -> Dict[str, Any]:
        """
        Đẩy gói tin Envelope đã ký số Bệnh viện lên Cổng Quốc gia.
        Tuyệt đối từ chối nếu gói tin chưa có chữ ký số hợp lệ.
        """
        signature = (envelope.get("signature") or "").strip()
        if not signature or signature.startswith("UNSIGNED"):
            return {
                "success": False,
                "status_code": 400,
                "error": "Gói tin chưa được ký số điện tử Bệnh viện! Vui lòng thực hiện Ký số trước khi bấm Đẩy lên Cổng.",
            }

        portal_cfg = self._get_portal_config()
        env = portal_cfg.get("env", "sandbox")
        base_url = self._get_base_url(portal_cfg)
        endpoint = f"{base_url}/api/platform/data-sync/push"
        simulation_mode = bool(portal_cfg.get("simulation_mode", True))
        password = (portal_cfg.get("password") or "").strip()

        start_time = time.perf_counter()

        # Nếu bật chế độ Mô phỏng Cổng Quốc gia (Sandbox Simulation) hoặc chưa cấu hình mật khẩu thật
        if simulation_mode or not password:
            time.sleep(0.35)
            exec_ms = int((time.perf_counter() - start_time) * 1000)
            tz = datetime.timezone(datetime.timedelta(hours=7))
            now_iso = datetime.datetime.now(tz).isoformat()
            receipt_id = f"BYT_EMRHUB_{package_id}"

            sim_response = {
                "code": "200",
                "message": "Tiếp nhận gói tin Khám sức khỏe đã ký số thành công (Trục dữ liệu Quốc gia EMRHub - Sandbox)",
                "data": {
                    "msg_id": package_id,
                    "receipt_id": receipt_id,
                    "accepted_records": record_count,
                    "rejected_records": 0,
                    "signature_verified": True,
                    "checksum_verified": envelope.get("checksum"),
                    "received_at": now_iso,
                },
            }

            self._log_push(
                package_id=package_id,
                batch_id=batch_id,
                target_env=f"{env.upper()}_SIMULATION",
                endpoint=endpoint,
                record_count=record_count,
                http_status=200,
                is_success=True,
                is_simulation=True,
                request_summary=json.dumps(
                    {
                        "header": envelope.get("header"),
                        "checksum": envelope.get("checksum"),
                        "signature_preview": signature[:48] + "...",
                    },
                    ensure_ascii=False,
                ),
                response_payload=json.dumps(sim_response, ensure_ascii=False),
                error_message=None,
                execution_time_ms=exec_ms,
                created_by=sender_username,
            )

            return {
                "success": True,
                "is_simulation": True,
                "status_code": 200,
                "portal_msg_id": receipt_id,
                "message": sim_response["message"],
                "data": sim_response,
                "execution_time_ms": exec_ms,
            }

        # Gọi API Cổng Quốc Gia thật khi có cấu hình tài khoản & tắt chế độ Simulation
        username = (portal_cfg.get("username") or "91034").strip()
        try:
            login_url = f"{base_url}/api/auth/login"
            login_res = requests.post(
                login_url,
                json={"username": username, "password": password},
                timeout=12,
            )
            if login_res.status_code not in (200, 201):
                exec_ms = int((time.perf_counter() - start_time) * 1000)
                err_msg = f"Đăng nhập Cổng Quốc gia thất bại (HTTP {login_res.status_code}): {login_res.text[:300]}"
                self._log_push(
                    package_id=package_id,
                    batch_id=batch_id,
                    target_env=env.upper(),
                    endpoint=login_url,
                    record_count=record_count,
                    http_status=login_res.status_code,
                    is_success=False,
                    is_simulation=False,
                    request_summary=json.dumps({"username": username}),
                    response_payload=login_res.text[:2000],
                    error_message=err_msg,
                    execution_time_ms=exec_ms,
                    created_by=sender_username,
                )
                return {"success": False, "status_code": login_res.status_code, "error": err_msg}

            login_json = login_res.json()
            token = (
                login_json.get("token")
                or login_json.get("access_token")
                or (login_json.get("data", {}).get("access_token") if isinstance(login_json.get("data"), dict) else None)
            )

            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            push_res = requests.post(endpoint, json=envelope, headers=headers, timeout=25)
            exec_ms = int((time.perf_counter() - start_time) * 1000)
            is_ok = push_res.status_code in (200, 201)

            try:
                resp_data = push_res.json()
            except Exception:
                resp_data = {"raw": push_res.text}

            err_msg = None if is_ok else f"Cổng phản hồi lỗi HTTP {push_res.status_code}: {push_res.text[:300]}"
            self._log_push(
                package_id=package_id,
                batch_id=batch_id,
                target_env=env.upper(),
                endpoint=endpoint,
                record_count=record_count,
                http_status=push_res.status_code,
                is_success=is_ok,
                is_simulation=False,
                request_summary=json.dumps(
                    {
                        "header": envelope.get("header"),
                        "checksum": envelope.get("checksum"),
                        "signature_preview": signature[:48] + "...",
                    },
                    ensure_ascii=False,
                ),
                response_payload=push_res.text[:3000],
                error_message=err_msg,
                execution_time_ms=exec_ms,
                created_by=sender_username,
            )

            if is_ok:
                return {
                    "success": True,
                    "is_simulation": False,
                    "status_code": push_res.status_code,
                    "portal_msg_id": package_id,
                    "message": "Đã đẩy dữ liệu lên Cổng Quốc gia thành công!",
                    "data": resp_data,
                    "execution_time_ms": exec_ms,
                }
            return {
                "success": False,
                "status_code": push_res.status_code,
                "error": err_msg,
                "data": resp_data,
            }

        except Exception as e:
            exec_ms = int((time.perf_counter() - start_time) * 1000)
            err_msg = f"Lỗi kết nối tới Cổng Quốc gia ({endpoint}): {str(e)}"
            self._log_push(
                package_id=package_id,
                batch_id=batch_id,
                target_env=env.upper(),
                endpoint=endpoint,
                record_count=record_count,
                http_status=0,
                is_success=False,
                is_simulation=False,
                request_summary=json.dumps({"package_id": package_id}),
                response_payload=str(e),
                error_message=err_msg,
                execution_time_ms=exec_ms,
                created_by=sender_username,
            )
            return {"success": False, "status_code": 0, "error": err_msg}

    def _log_push(
        self,
        package_id: str,
        batch_id: int,
        target_env: str,
        endpoint: str,
        record_count: int,
        http_status: int,
        is_success: bool,
        is_simulation: bool,
        request_summary: str,
        response_payload: str,
        error_message: str,
        execution_time_ms: int,
        created_by: str,
    ):
        conn = get_conn()
        try:
            conn.execute(
                """
                INSERT INTO portal_push_logs (
                    package_id, batch_id, target_env, endpoint, record_count,
                    http_status, is_success, is_simulation, request_summary,
                    response_payload, error_message, execution_time_ms, created_by, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    package_id,
                    batch_id,
                    target_env,
                    endpoint,
                    record_count,
                    http_status,
                    1 if is_success else 0,
                    1 if is_simulation else 0,
                    request_summary,
                    response_payload,
                    error_message,
                    execution_time_ms,
                    created_by,
                    now_vn_str(),
                ),
            )
            conn.commit()
        finally:
            conn.close()


portal_client = NationalPortalClient()
