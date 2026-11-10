import os
from pathlib import Path
from dotenv import load_dotenv

SERVER_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = SERVER_DIR.parent

if (SERVER_DIR / ".env").exists():
    load_dotenv(SERVER_DIR / ".env")
elif (ROOT_DIR / ".env").exists():
    load_dotenv(ROOT_DIR / ".env")

DATA_DIR = Path(os.getenv("DATA_DIR", str(SERVER_DIR / "data")))
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(DATA_DIR / "uploads")))
SAMPLES_DIR = Path(os.getenv("SAMPLES_DIR", str(DATA_DIR / "samples")))

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "ksk_gateway.db"

JWT_SECRET = os.getenv("JWT_SECRET", "binhan-ksk-portal-gateway-secret-key-2026")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24
