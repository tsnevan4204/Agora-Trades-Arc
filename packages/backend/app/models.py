from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field


class EventProposal(BaseModel):
    proposalId: str
    createdAtUtc: datetime = Field(default_factory=datetime.utcnow)
    proposerAddress: str
    title: str
    category: str
    ticker: str
    metric: str
    fiscalYear: int
    fiscalQuarter: int
    suggestedRanges: list[str] = Field(default_factory=list)
    status: str = "pending"
    adminNotes: str | None = None


class ProposalMarketSpec(BaseModel):
    question: str
    resolutionSpecHash: str  # 0x-prefixed 66-char hex from client
    resolutionSpecURI: str


class ProposalApproveRequest(BaseModel):
    """Admin approves proposal and creates event + markets on-chain."""
    confirmedBy: str
    closeTimeUnix: int  # unix seconds; must be > block time on chain
    markets: list[ProposalMarketSpec] = Field(min_length=1)


class ProposalRejectRequest(BaseModel):
    confirmedBy: str
    reason: str = Field(min_length=1)


class AdminResolveRequest(BaseModel):
    """Admin manually resolves markets with specified outcomes."""
    confirmedBy: str
    marketIds: list[int] = Field(min_length=1)
    outcomes: dict[str, str]  # JSON keys are strings; "0" -> "YES"
    reason: str | None = None


class RelayForwardRequest(BaseModel):
    from_address: str = Field(alias="from")
    to: str
    value: int = 0
    gas: int
    deadline: int
    data: str
    signature: str


class RelayExecuteResponse(BaseModel):
    ok: bool
    txHash: str | None = None
    reason: str | None = None
