from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass
from dotenv import load_dotenv

ROOT_ENV_PATH = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(ROOT_ENV_PATH)

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_LOCAL_DATA = _BACKEND_ROOT / "data"

_DEFAULT_CORS_ORIGINS = [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
]


def _parse_csv_urls(raw: str) -> list[str]:
    return [p.strip() for p in raw.split(",") if p.strip()]


def _normalize_pk_hex(pk: str) -> str:
    s = pk.strip()
    if not s:
        return ""
    return s[2:].lower() if s.startswith("0x") else s.lower()


@dataclass
class Settings:
    gcs_bucket: str = os.getenv("GCS_BUCKET", "agora-market-data")
    # Arc testnet RPC. Both env names are accepted for flexibility.
    rpc_url: str = os.getenv("ARC_TESTNET_RPC_URL") or os.getenv("RPC_URL", "")
    manager_address: str = os.getenv("MANAGER_ADDRESS", "")
    exchange_address: str = os.getenv("EXCHANGE_ADDRESS", "")
    forwarder_address: str = os.getenv("FORWARDER_ADDRESS", "")
    factory_address: str = os.getenv("FACTORY_ADDRESS", "")
    relayer_private_key: str = os.getenv("RELAYER_PRIVATE_KEY", "")
    resolver_private_key: str = os.getenv("RESOLVER_PRIVATE_KEY", "")
    factory_owner_private_key: str = os.getenv("FACTORY_OWNER_PRIVATE_KEY", "") or os.getenv("DEPLOYER_PRIVATE_KEY", "")
    event_listener_poll_interval_seconds: int = int(os.getenv("EVENT_LISTENER_POLL_INTERVAL_SECONDS", "15"))
    gcs_batch_interval_seconds: int = int(os.getenv("GCS_BATCH_INTERVAL_SECONDS", "60"))
    # CORS: if CORS_ALLOW_ORIGINS is set, only those origins are allowed; otherwise local dev defaults.
    cors_allow_origins: tuple[str, ...] = tuple(
        _parse_csv_urls(os.getenv("CORS_ALLOW_ORIGINS", "")) or _DEFAULT_CORS_ORIGINS
    )
    # Storage: auto = GCS when GOOGLE_APPLICATION_CREDENTIALS points to a real file, else local disk under AGORA_LOCAL_DATA_DIR.
    storage_backend: str = os.getenv("STORAGE_BACKEND", "auto").strip().lower()
    local_data_dir: Path = Path(os.getenv("AGORA_LOCAL_DATA_DIR", str(_DEFAULT_LOCAL_DATA))).expanduser().resolve()


settings = Settings()

_r = _normalize_pk_hex(settings.relayer_private_key)
_s = _normalize_pk_hex(settings.resolver_private_key)
if _r and _s and _r == _s:
    raise ValueError(
        "RELAYER_PRIVATE_KEY and RESOLVER_PRIVATE_KEY must be different keys. "
        "Relayer is a gas-only hot wallet for EIP-2771 forwarder calls; resolver is the on-chain "
        "resolver/admin-capable wallet (see PROJECT_PLAN.md — Backend hot wallets)."
    )
