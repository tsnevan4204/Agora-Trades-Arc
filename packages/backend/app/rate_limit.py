"""
In-process per-IP token-bucket rate limiter for the public `/data/*` API.

This is deliberately the simplest thing that protects you from the obvious
abuse vectors: a script in a loop, a malformed dashboard polling every 100ms,
an LLM agent that doesn't know about backoff. It does NOT protect against
distributed attacks (different IPs all hitting at once) — that's a job for
Cloudflare / Cloud Armor / a real WAF in front of the service.

Limits are env-driven so you can dial them per-deployment:

    DATA_API_RATE_LIMIT_PER_MIN=60      # requests / IP / minute (default 60)
    DATA_API_RATE_LIMIT_BURST=20        # short-burst allowance     (default 20)

A request consumes 1 token. The bucket refills at `per_min/60` tokens per
second, up to `burst` tokens cap. When a request arrives with the bucket
empty we return HTTP 429 with a `Retry-After` header.

Why in-process and not Redis: the trade-off here is throughput vs. setup
cost. For a single backend instance this is exactly correct; the moment you
scale to two replicas the limits become per-replica which is "more lenient
than advertised but never less". Document the scale-out path; replace with a
shared store when needed.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request


def _env_int(name: str, default: int, lo: int = 1, hi: int = 100_000) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        v = int(raw)
    except ValueError:
        return default
    return max(lo, min(hi, v))


def _per_min() -> int:
    return _env_int("DATA_API_RATE_LIMIT_PER_MIN", 60)


def _burst() -> int:
    return _env_int("DATA_API_RATE_LIMIT_BURST", 20)


@dataclass
class _Bucket:
    tokens: float
    last_refill_monotonic: float


# Per-IP buckets are kept in a plain dict guarded by a single lock. uvicorn
# with the default `--workers 1` runs everything in one process, so this is
# safe; if you scale to multi-worker the dict isn't shared (see module
# docstring).
_buckets: dict[str, _Bucket] = {}
_lock = threading.Lock()


def _client_ip(request: Request) -> str:
    """Best-effort client IP extraction.

    Honours `X-Forwarded-For` (first hop) when present so requests behind a
    proxy (Cloudflare, Cloud Run, nginx) get rate-limited per real client,
    not per proxy. Falls back to the socket peer.
    """
    fwd = request.headers.get("x-forwarded-for", "").strip()
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def rate_limit(request: Request) -> None:
    """FastAPI dependency: throws 429 if the calling IP exceeds its budget."""
    per_min = _per_min()
    burst = _burst()
    refill_per_sec = per_min / 60.0
    now = time.monotonic()
    ip = _client_ip(request)

    with _lock:
        b = _buckets.get(ip)
        if b is None:
            # New caller starts with a full burst allowance.
            _buckets[ip] = _Bucket(tokens=float(burst) - 1.0, last_refill_monotonic=now)
            return

        elapsed = now - b.last_refill_monotonic
        b.tokens = min(float(burst), b.tokens + elapsed * refill_per_sec)
        b.last_refill_monotonic = now

        if b.tokens < 1.0:
            # Compute how long until one full token is available so we can
            # send a useful `Retry-After`. We use math instead of polling so
            # the value is exact even when the bucket is far below zero.
            need = 1.0 - b.tokens
            wait_seconds = max(1, int(need / refill_per_sec) + 1)
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Rate limit exceeded — {per_min} req/min/IP, burst {burst}. "
                    f"Retry after {wait_seconds}s."
                ),
                headers={"Retry-After": str(wait_seconds)},
            )

        b.tokens -= 1.0
