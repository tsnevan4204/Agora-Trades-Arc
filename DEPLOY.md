# Deployment Guide — Agora

This guide walks through deploying Agora end-to-end:

| Component | Host | URL after deploy |
|---|---|---|
| Frontend (Next.js) | Vercel | `https://agoratrades.org` |
| Backend (FastAPI + fills indexer) | Google Cloud Run | `https://api.agoratrades.org` |
| Smart contracts | Circle Arc testnet (already deployed) | — |
| Data lake | Google Cloud Storage (already provisioned) | `gs://agora_datalake` |
| Analytics | BigQuery external table (already provisioned) | `agora_lake.trades_fills` |

**Expected cost:** ~$5–12/month for Cloud Run + $0 for everything else.

---

## 0. One-time prerequisites

Install the CLIs on your laptop:

```bash
# Google Cloud SDK — for backend deploy
brew install --cask google-cloud-sdk

# Vercel CLI — for frontend deploy
npm install -g vercel

# Authenticate
gcloud auth login
gcloud auth application-default login
gcloud config set project agora-492710

vercel login
```

Enable the GCP APIs we'll use:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

---

## 1. Create the runtime service account

Cloud Run will execute the backend as this identity. **Do not reuse** the JSON-key service account from local dev — keep them separate so you can rotate one without breaking the other.

```bash
PROJECT_ID=agora-492710

gcloud iam service-accounts create agora-backend-runtime \
  --display-name="Agora backend runtime (Cloud Run)" \
  --project=${PROJECT_ID}

SA_EMAIL=agora-backend-runtime@${PROJECT_ID}.iam.gserviceaccount.com

# GCS access — the backend reads/writes the agora_datalake bucket.
gcloud storage buckets add-iam-policy-binding gs://agora_datalake \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"

# BigQuery access — the /data/trades endpoint queries the external table.
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/bigquery.jobUser"
```

---

## 2. Prepare the production `.env`

Copy the template and fill in real values:

```bash
cp .env.production.example .env
```

**Generate a real `ADMIN_SESSION_SECRET`** — do not leave the literal `$(openssl rand -base64 48)` text in the file (`.env` files don't run shell commands):

```bash
openssl rand -base64 48
# Copy the OUTPUT (looks like 'aqtdaaNEJ+mRO5x...') and paste it as the value:
#   ADMIN_SESSION_SECRET=<the actual output>
```

Required values (the deploy script will fail loudly if any are missing):

| Variable | Notes |
|---|---|
| `GCP_PROJECT_ID` | `agora-492710` |
| `CLOUD_RUN_SA` | from step 1 (`agora-backend-runtime@…`) |
| `GCS_BUCKET` | `agora_datalake` |
| `BQ_PROJECT` / `BQ_DATASET` / `BQ_LOCATION` | already provisioned |
| `RPC_URL` | Alchemy URL |
| `RELAYER_PRIVATE_KEY` / `RESOLVER_PRIVATE_KEY` / `DEPLOYER_PRIVATE_KEY` | three **different** hot wallets |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` | admin auth |
| `CORS_ALLOW_ORIGINS` | `https://agoratrades.org,https://www.agoratrades.org` |
| `FMP_API_KEY` | resolution fallback |

> **Heads-up on secret storage:** this deploy ships all config — including private keys and admin password — as plain environment variables on Cloud Run. They're visible in the GCP console to anyone with project access. Acceptable for a small testnet launch with a one-person team; **before mainnet** you should move secrets to Google Secret Manager (a few line changes in `cloudrun-deploy.sh`).

---

## 3. Deploy the backend

```bash
./packages/backend/deploy/cloudrun-deploy.sh
```

What happens:

1. Builds the container with **Cloud Build** (no local Docker required).
2. Pushes the image to Artifact Registry (`us-central1-docker.pkg.dev/agora-492710/agora-images/agora-backend`).
3. Deploys to Cloud Run with:
   - `--min-instances=1 --max-instances=1` — exactly one container at all times. **Critical** for the fills indexer (running it twice would double-process events).
   - `--no-cpu-throttling` — CPU stays allocated between requests so the asyncio poll loop keeps ticking.
   - All non-secret config from `.env` via `--set-env-vars`.
   - All secrets from Secret Manager via `--set-secrets`.

First deploy takes ~5 min (image build dominates). Subsequent deploys are ~2 min.

The script prints the final URL at the end:

```
✓ Deployed.
  URL: https://agora-backend-xxxxxxxxxx-uc.a.run.app
  Health: curl https://agora-backend-xxxxxxxxxx-uc.a.run.app/health
```

Hit `/health` and verify:

```json
{
  "ok": true,
  "storage": "gcs",
  "adminAuthConfigured": true,
  "fillsIndexer": { "enabled": true, "lastBlock": 43712345, "updatedAtUtc": "..." }
}
```

If `storage` is anything other than `gcs`, the service account doesn't have GCS access — re-check step 1.

---

## 4. Map your custom domain to Cloud Run

In the GCP console: **Cloud Run → agora-backend → Manage Custom Domains → Add Mapping**.

1. Enter `api.agoratrades.org`.
2. Google asks you to verify domain ownership (one-time, via Webmaster Central).
3. Once verified, Google gives you a DNS record to add:

```
Type: CNAME
Host: api
Value: ghs.googlehosted.com.
```

Add it at your DNS registrar. TLS certs are auto-provisioned within ~15 minutes. Then:

```bash
curl https://api.agoratrades.org/health
```

---

## 5. Deploy the frontend to Vercel

From the repo root:

```bash
cd packages/AgoraFrontEnd

# First time — link the project. Vercel auto-detects Next.js.
vercel link

# Add env vars (or set them in the Vercel dashboard).
vercel env add NEXT_PUBLIC_BACKEND_URL production
# paste: https://api.agoratrades.org

vercel env add NEXT_PUBLIC_ARC_TESTNET_RPC_URL production
# paste: https://arc-testnet.g.alchemy.com/v2/YOUR_KEY

vercel env add NEXT_PUBLIC_ARC_RPC_URL production
# paste: same as above

vercel env add NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID production
# paste: your WalletConnect project id

# Deploy.
vercel --prod
```

You'll get a `https://agora-trades.vercel.app` URL out of the box.

To use `agoratrades.org`:

1. **Vercel dashboard → Project → Settings → Domains → Add** `agoratrades.org` and `www.agoratrades.org`.
2. Vercel shows you the DNS records to add at your registrar:

```
Type: A    Host: @     Value: 76.76.21.21
Type: CNAME Host: www   Value: cname.vercel-dns.com.
```

3. Add both records. TLS provisions automatically.

---

## 6. End-to-end smoke test

Once both deploys are live and DNS has propagated:

```bash
# Backend health
curl https://api.agoratrades.org/health

# Public data API
curl https://api.agoratrades.org/data/trades?limit=3

# Admin login flow
curl -X POST https://api.agoratrades.org/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"YOUR_ADMIN_PASSWORD"}'

# CORS preflight (run from your browser devtools while on agoratrades.org)
fetch('https://api.agoratrades.org/health').then(r => r.json()).then(console.log)
```

In the browser at `https://agoratrades.org`:
- [ ] Wallet connect works
- [ ] Markets list loads
- [ ] Admin login at `/admin` works
- [ ] Place a test trade → wait ~60s → check `https://api.agoratrades.org/data/trades?limit=1` for the new fill

---

## Redeploying

**Backend (after code changes):**

```bash
./packages/backend/deploy/cloudrun-deploy.sh
```

Builds a fresh image tagged with the current timestamp and rolls out a new Cloud Run revision. Old revisions are kept; you can roll back from the console (Cloud Run → Service → Revisions → Manage Traffic).

**Backend env / secret changes:**

```bash
# Edit values directly in your repo-root .env, then redeploy:
./packages/backend/deploy/cloudrun-deploy.sh
```

(The script re-reads `.env` on every run and pushes the current values to Cloud Run.)

**Frontend (after code changes):**

```bash
cd packages/AgoraFrontEnd
vercel --prod
```

---

## Monitoring + ops

**Cloud Run logs:**

```bash
gcloud run services logs read agora-backend \
  --region=us-central1 --project=agora-492710 --limit=100
```

Or in the console: **Cloud Run → agora-backend → Logs**.

**Indexer health** — `/health` exposes `fillsIndexer.lastBlock`. Set up an external monitor (UptimeRobot, Better Stack — both have free tiers) that pings `/health` every 5 min and alerts if `lastBlock` stops advancing.

**Relayer wallet balance** — manually check periodically, or write a one-line cron that compares balance to a threshold. If the relayer runs dry, gasless trades silently fail.

**Budget alert** — in the GCP console: **Billing → Budgets & alerts → Create budget**. Set to $20/month so a runaway Cloud Run config can't surprise you.

---

## Rolling secrets

Rotate any of `RELAYER_PRIVATE_KEY`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, etc.:

1. Update the value in your repo-root `.env`.
2. Run `./packages/backend/deploy/cloudrun-deploy.sh` — new value goes live on the next revision.

If you rotate `RELAYER_PRIVATE_KEY`, **fund the new wallet** with Arc testnet ETH before the deploy or relays will fail.

If you rotate `ADMIN_SESSION_SECRET`, all currently-logged-in admin sessions are invalidated and you'll need to log back in.

---

## Local Docker build (optional)

If you want to test the production image before pushing:

```bash
# Start Docker Desktop, then:
docker build -t agora-backend:local packages/backend

docker run --rm -p 8080:8080 \
  -v "$HOME/.config/gcloud/application_default_credentials.json:/secrets/sa.json:ro" \
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json \
  --env-file .env \
  agora-backend:local

curl http://localhost:8080/health
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/health` shows `storage: local` | Service account lacks GCS access | Re-run the `add-iam-policy-binding` in step 1 |
| `/health` shows `adminAuthConfigured: false` | `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` missing or blank in `.env` | Fill them in and re-run `cloudrun-deploy.sh` |
| `fillsIndexer.lastBlock` not advancing | CPU throttling re-enabled | Confirm `--no-cpu-throttling` is in the deploy script |
| `403` on `/data/trades` | `DATA_API_PUBLIC=0` and no `X-API-Key` | Either set `DATA_API_PUBLIC=1` or pass the key |
| CORS errors in browser | Frontend domain not in `CORS_ALLOW_ORIGINS` | Update env, redeploy backend |
| `eth_getLogs` 400s | `FILLS_RPC_MAX_BLOCK_SPAN > 10` on free Alchemy tier | Keep it at `10` or upgrade Alchemy |
| `503` from Cloud Run | Container failed to start | `gcloud run services logs read agora-backend --limit=50` |
