from __future__ import annotations

from typing import Any
import pytest


class InMemoryStore:
    def __init__(self) -> None:
        self.items: dict[str, Any] = {}

    def write_json(self, path: str, payload: dict) -> None:
        self.items[path] = payload
        print(f"  📦 [store] write_json {path!r} → dict with keys: {list(payload.keys())}")

    def read_json(self, path: str) -> dict | None:
        v = self.items.get(path)
        out = v if isinstance(v, dict) else None
        tag = "✅ HIT" if out is not None else "❌ MISS"
        print(f"  📬 [store] read_json {path!r} → {tag}")
        return out

    def write_text(self, path: str, data: str, content_type: str = "text/plain") -> None:
        self.items[path] = data
        print(f"  📄 [store] write_text {path!r} → {len(data)} bytes ({content_type})")

    def read_text(self, path: str) -> str | None:
        v = self.items.get(path)
        out = v if isinstance(v, str) else None
        print(f"  📄 [store] read_text path={path!r} hit={out is not None}")
        return out

    def write_parquet(self, path: str, payload: list) -> None:
        self.items[path] = {"parquet_rows": list(payload)}
        print(f"  🗃️ [store] write_parquet path={path!r} rows={len(payload)}")


@pytest.fixture()
def memory_store(monkeypatch: pytest.MonkeyPatch) -> InMemoryStore:
    import app.storage as storage_mod

    mem = InMemoryStore()
    monkeypatch.setattr(storage_mod, "_override", mem)
    monkeypatch.setattr(storage_mod, "_cached_backend", None)
    print("\n🧪 (fixture memory_store) Swapped storage for an in-memory dict — no real GCS calls in this test.")
    yield mem
    monkeypatch.setattr(storage_mod, "_override", None)
    monkeypatch.setattr(storage_mod, "_cached_backend", None)
    n = len(mem.items)
    paths = sorted(mem.items.keys())
    print(f"\n✅ (fixture memory_store) Test finished. In-memory store held {n} object(s).")
    if paths:
        print(f"   Paths touched: {paths}")
