from __future__ import annotations

import io
import json
import os
from pathlib import Path
from typing import Any, Protocol

from google.cloud import storage

from .config import settings


class StorageBackend(Protocol):
    def write_json(self, path: str, payload: dict) -> None: ...
    def read_json(self, path: str) -> dict | None: ...
    def write_text(self, path: str, data: str, content_type: str = "text/plain") -> None: ...
    def read_text(self, path: str) -> str | None: ...
    def write_parquet(self, path: str, rows: list[dict[str, Any]]) -> None: ...
    def list_keys(self, prefix: str) -> list[str]: ...


class GcsStore:
    def __init__(self) -> None:
        self.client = storage.Client()
        self.bucket = self.client.bucket(settings.gcs_bucket)

    def write_json(self, path: str, payload: dict) -> None:
        blob = self.bucket.blob(path)
        blob.upload_from_string(json.dumps(payload, default=str, indent=2), content_type="application/json")

    def read_json(self, path: str) -> dict | None:
        blob = self.bucket.blob(path)
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())

    def write_text(self, path: str, data: str, content_type: str = "text/plain") -> None:
        blob = self.bucket.blob(path)
        blob.upload_from_string(data, content_type=content_type)

    def read_text(self, path: str) -> str | None:
        blob = self.bucket.blob(path)
        if not blob.exists():
            return None
        return blob.download_as_text()

    def write_parquet(self, path: str, rows: list[dict[str, Any]]) -> None:
        import pyarrow as pa
        import pyarrow.parquet as pq

        table = pa.Table.from_pylist(rows)
        buf = io.BytesIO()
        pq.write_table(table, buf)
        blob = self.bucket.blob(path)
        blob.upload_from_string(buf.getvalue(), content_type="application/octet-stream")

    def list_keys(self, prefix: str) -> list[str]:
        blobs = self.client.list_blobs(self.bucket.name, prefix=prefix)
        return [b.name for b in blobs]


class LocalFilesystemStore:
    """JSON/text/parquet under AGORA_LOCAL_DATA_DIR — no GCP credentials required."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _safe_path(self, key: str) -> Path:
        if ".." in key or key.startswith("/"):
            raise ValueError(f"Invalid storage path: {key!r}")
        p = (self.root / key).resolve()
        try:
            p.relative_to(self.root.resolve())
        except ValueError as e:
            raise ValueError(f"Invalid storage path: {key!r}") from e
        return p

    def write_json(self, path: str, payload: dict) -> None:
        fp = self._safe_path(path)
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(json.dumps(payload, default=str, indent=2), encoding="utf-8")

    def read_json(self, path: str) -> dict | None:
        fp = self._safe_path(path)
        if not fp.is_file():
            return None
        return json.loads(fp.read_text(encoding="utf-8"))

    def write_text(self, path: str, data: str, content_type: str = "text/plain") -> None:
        _ = content_type
        fp = self._safe_path(path)
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(data, encoding="utf-8")

    def read_text(self, path: str) -> str | None:
        fp = self._safe_path(path)
        if not fp.is_file():
            return None
        return fp.read_text(encoding="utf-8")

    def write_parquet(self, path: str, rows: list[dict[str, Any]]) -> None:
        import pyarrow as pa
        import pyarrow.parquet as pq

        table = pa.Table.from_pylist(rows)
        fp = self._safe_path(path)
        fp.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(table, fp)

    def list_keys(self, prefix: str) -> list[str]:
        base = self.root / prefix.strip("/")
        if not base.exists():
            return []
        return [
            str(p.relative_to(self.root))
            for p in sorted(base.rglob("*"))
            if p.is_file()
        ]


_override: StorageBackend | None = None
_cached_backend: StorageBackend | None = None


def _gcs_credentials_ready() -> bool:
    cred = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not cred:
        return False
    return Path(cred).expanduser().is_file()


def _build_store() -> StorageBackend:
    mode = settings.storage_backend
    if mode == "local":
        return LocalFilesystemStore(settings.local_data_dir)
    if mode == "gcs":
        return GcsStore()
    if mode == "auto":
        if _gcs_credentials_ready():
            return GcsStore()
        return LocalFilesystemStore(settings.local_data_dir)
    raise ValueError(f"Unknown STORAGE_BACKEND={mode!r} (use auto, gcs, or local)")


def get_store() -> StorageBackend:
    """Return storage backend. Tests may set ``_override``."""
    global _cached_backend
    if _override is not None:
        return _override
    if _cached_backend is None:
        _cached_backend = _build_store()
    return _cached_backend


def store_backend_kind() -> str:
    """Short label for /health (e.g. gcs, local)."""
    if _override is not None:
        return "memory"
    s = get_store()
    if isinstance(s, GcsStore):
        return "gcs"
    if isinstance(s, LocalFilesystemStore):
        return "local"
    return type(s).__name__


class _StoreDelegate:
    """Bound methods forward to get_store() so `from .storage import store` works."""

    def write_json(self, path: str, payload: dict) -> None:
        get_store().write_json(path, payload)

    def read_json(self, path: str) -> dict | None:
        return get_store().read_json(path)

    def write_text(self, path: str, data: str, content_type: str = "text/plain") -> None:
        get_store().write_text(path, data, content_type=content_type)

    def read_text(self, path: str) -> str | None:
        return get_store().read_text(path)

    def write_parquet(self, path: str, rows: list[dict[str, Any]]) -> None:
        get_store().write_parquet(path, rows)

    def list_keys(self, prefix: str) -> list[str]:
        return get_store().list_keys(prefix)


store = _StoreDelegate()
