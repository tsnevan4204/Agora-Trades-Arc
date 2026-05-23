# syntax=docker/dockerfile:1.7
#
# Production image for the Agora FastAPI backend (Cloud Run target).
#
# Design notes:
#  • Two-stage build: install deps in a builder layer, then copy only the
#    compiled site-packages into a slim runtime. Keeps the final image small
#    (~250 MB instead of ~600 MB) and avoids shipping pip + build tools to
#    production.
#  • Pinned to python:3.11-slim — matches the local dev venv and is the
#    smallest official image that still has glibc (needed by pyarrow wheels).
#  • Runs as a non-root user. Cloud Run honours this and several scanners
#    flag root-as-PID-1 as a finding.
#  • CMD honours the $PORT env var that Cloud Run injects (defaults to 8080).
#  • No GCP service-account JSON is baked in. Cloud Run uses Application
#    Default Credentials via the bound service account; locally docker run
#    can mount the key with `-v /path/to/key.json:/secrets/sa.json -e
#    GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json`.

# ---------- Stage 1: builder ----------
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# pyarrow ships manylinux wheels for x86_64 + arm64, so we don't need a
# C compiler in the builder. If you swap in a Python lib that needs to
# build from source, add: build-essential gcc here.
WORKDIR /build

COPY requirements.txt .

# Install into an isolated prefix so we can copy a clean tree into the
# runtime stage without dragging /usr/local along.
RUN pip install --prefix=/install -r requirements.txt

# ---------- Stage 2: runtime ----------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Make the prefix from the builder discoverable by Python.
    PYTHONPATH=/install/lib/python3.11/site-packages \
    PATH=/install/bin:$PATH \
    # Cloud Run sets PORT; default for local docker runs.
    PORT=8080

# Non-root user for the runtime container. UID 1000 is conventional and
# matches what most local development environments use, which makes it
# easier to share volumes during local docker runs.
RUN groupadd --system app && useradd --system --gid app --uid 1000 app

WORKDIR /srv/app

# Bring the installed packages and any console scripts (uvicorn, etc).
COPY --from=builder /install /install

# Application code — keep this layer last so code changes don't bust the
# heavy dependency layer above on every rebuild.
COPY --chown=app:app app ./app
COPY --chown=app:app scripts ./scripts

USER app

EXPOSE 8080

# Single uvicorn worker on purpose:
#   • fills_indexer.start() spins up a background asyncio task; running
#     multiple workers would double-process OfferFilled events.
#   • Cloud Run scales by spinning more containers, not workers — and we
#     pin --min-instances=1 --max-instances=1 on deploy for the same
#     reason. See deploy/cloudrun-deploy.sh.
#   • --proxy-headers makes uvicorn trust X-Forwarded-* from Cloud Run's
#     front-end so rate_limit.py sees real client IPs.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
