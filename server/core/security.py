import hashlib
import hmac
import datetime
import jwt
from typing import Optional
from server.core.config import JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRE_HOURS


def hash_password(password: str) -> str:
    salt = "binhan_ksk_gateway_2026"
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def verify_password(plain_password: str, password_hash: str) -> bool:
    expected = hash_password(plain_password)
    return hmac.compare_digest(expected, password_hash)


def create_access_token(username: str, role: str = "ADMIN") -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": username,
        "role": role,
        "iat": now,
        "exp": now + datetime.timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None
