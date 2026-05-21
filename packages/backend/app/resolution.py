"""Evidence hash computation for admin market resolution."""

from __future__ import annotations

import json
from web3 import Web3


def evidence_hash(
    outcomes: dict[str, str],
    confirmed_utc: str,
    admin_address: str,
    reason: str | None = None,
) -> str:
    """Compute a deterministic keccak256 evidence hash for an admin resolution decision."""
    payload = {
        "outcomes": outcomes,
        "confirmedAtUtc": confirmed_utc,
        "adminAddress": admin_address,
        "reason": reason,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return Web3.keccak(text=canonical).hex()
