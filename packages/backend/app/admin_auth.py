"""
Admin authentication for the Agora backend.

The previous design relied on a client-side hardcoded `username/password` in
`admin-console.tsx` and zero backend enforcement — anyone who could reach the
backend URL could call `/proposals/{id}/approve` or `/resolution/resolve/...`
directly. That's unacceptable for prod; this module fixes both halves:

  • `POST /admin/login` validates env-driven credentials and returns a short-
    lived HMAC-signed bearer token to the frontend.
  • `Depends(require_admin)` on every mutating admin endpoint validates that
    bearer on every subsequent request.

Token format (URL-safe base64 of `payload || "." || signature`):

    payload   = JSON {"sub": "<username>", "exp": <unix-ts>}
    signature = hmac_sha256(secret, payload_bytes)

We deliberately roll our own minimal token instead of pulling in PyJWT to
avoid an extra dependency for what is effectively a single-trust-source
session cookie. The signing secret comes from `ADMIN_SESSION_SECRET`, and the
default TTL is 12h (`ADMIN_TOKEN_TTL_SECONDS`, override-able).

Operator setup — drop these into the root `.env`:

    ADMIN_USERNAME=alice
    ADMIN_PASSWORD=<a-long-random-string>
    ADMIN_SESSION_SECRET=<another-long-random-string>
    # optional, defaults to 43200 (12h):
    # ADMIN_TOKEN_TTL_SECONDS=43200
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException


# ── env-driven configuration ──────────────────────────────────────────────────

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "").strip()
ADMIN_SESSION_SECRET = os.getenv("ADMIN_SESSION_SECRET", "").strip()
ADMIN_TOKEN_TTL_SECONDS = int(os.getenv("ADMIN_TOKEN_TTL_SECONDS", "43200"))


def admin_auth_configured() -> bool:
    """True iff the operator has set all three required env vars."""
    return bool(ADMIN_USERNAME) and bool(ADMIN_PASSWORD) and bool(ADMIN_SESSION_SECRET)


# ── token issuing + verification ──────────────────────────────────────────────


@dataclass
class AdminPrincipal:
    """The authenticated admin attached to a request via `Depends(require_admin)`."""

    username: str
    expires_at: int  # unix seconds


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode((text + pad).encode("ascii"))


def _sign(payload_bytes: bytes) -> bytes:
    return hmac.new(
        ADMIN_SESSION_SECRET.encode("utf-8"),
        payload_bytes,
        hashlib.sha256,
    ).digest()


def issue_admin_token(username: str, ttl_seconds: int | None = None) -> tuple[str, int]:
    """Mint a fresh HMAC-signed token; returns (token, expires_at_unix_seconds)."""
    if not admin_auth_configured():
        raise RuntimeError("Admin auth env vars not configured")
    ttl = ttl_seconds if ttl_seconds and ttl_seconds > 0 else ADMIN_TOKEN_TTL_SECONDS
    expires_at = int(time.time()) + ttl
    payload = json.dumps(
        {"sub": username, "exp": expires_at, "jti": secrets.token_hex(8)},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    sig = _sign(payload)
    token = f"{_b64url_encode(payload)}.{_b64url_encode(sig)}"
    return token, expires_at


def verify_admin_token(token: str) -> AdminPrincipal:
    """Constant-time signature check + freshness check; raises on any mismatch."""
    if not admin_auth_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Admin auth not configured on backend. Set ADMIN_USERNAME, "
                "ADMIN_PASSWORD and ADMIN_SESSION_SECRET in the root .env."
            ),
        )
    if not token or "." not in token:
        raise HTTPException(status_code=401, detail="Malformed admin token")
    payload_b64, sig_b64 = token.split(".", 1)
    try:
        payload_bytes = _b64url_decode(payload_b64)
        sig_bytes = _b64url_decode(sig_b64)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Malformed admin token") from e
    expected = _sign(payload_bytes)
    # `hmac.compare_digest` is constant-time — important: a naive == would leak
    # timing information that lets an attacker incrementally guess the signature.
    if not hmac.compare_digest(expected, sig_bytes):
        raise HTTPException(status_code=401, detail="Invalid admin token signature")
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=401, detail="Malformed admin token") from e
    exp = int(payload.get("exp", 0))
    sub = str(payload.get("sub", ""))
    if exp <= int(time.time()):
        raise HTTPException(status_code=401, detail="Admin token expired — log in again")
    if sub != ADMIN_USERNAME:
        # Defence-in-depth: even with a valid signature, reject if the subject
        # doesn't match the currently-configured admin (e.g. operator rotated
        # ADMIN_USERNAME and an old token is still floating around).
        raise HTTPException(status_code=401, detail="Token subject not authorised")
    return AdminPrincipal(username=sub, expires_at=exp)


# ── credential check ──────────────────────────────────────────────────────────


def check_admin_credentials(username: str, password: str) -> bool:
    """Constant-time comparison against env-configured credentials."""
    if not admin_auth_configured():
        return False
    u_ok = hmac.compare_digest(username.encode("utf-8"), ADMIN_USERNAME.encode("utf-8"))
    p_ok = hmac.compare_digest(password.encode("utf-8"), ADMIN_PASSWORD.encode("utf-8"))
    return u_ok and p_ok


# ── FastAPI dependency ────────────────────────────────────────────────────────


def require_admin(authorization: str | None = Header(default=None)) -> AdminPrincipal:
    """`Depends(require_admin)` on any admin-only endpoint to enforce auth.

    The frontend sends `Authorization: Bearer <token>`; CORS preflight (OPTIONS)
    requests don't carry it, but FastAPI handles OPTIONS internally so this
    dependency only ever runs for real requests.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization: Bearer <token> header",
        )
    token = authorization[len("Bearer ") :].strip()
    return verify_admin_token(token)
