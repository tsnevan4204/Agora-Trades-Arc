import path from 'path'
import { fileURLToPath } from 'url'
import nextEnv from '@next/env'

const { loadEnvConfig } = nextEnv

const appDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(appDir, '../..')
const isVercel = Boolean(process.env.VERCEL)

// Monorepo: share repo-root `.env` with Hardhat/backend; frontend overrides in `.env.local`.
// On Vercel, env vars come from the dashboard — skip repo-root .env (often absent in the
// deployment bundle when Root Directory is packages/AgoraFrontEnd).
if (!isVercel) {
  loadEnvConfig(repoRoot)
}
loadEnvConfig(appDir)

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Local monorepo dev only. On Vercel this doubles the output path
  // (vercel/path0/vercel/path0/.next/...) and breaks the deploy.
  ...(isVercel ? {} : { outputFileTracingRoot: repoRoot }),
  // NOTE: don't set turbopack.root here — pointing it at appDir hits
  // vercel/next.js#90307 and breaks bare CSS @import 'tailwindcss'.
  // NOTE: don't override resolve.modules in webpack either; it forces top-level
  // resolution and breaks nested deps (e.g. viem's pinned ox version).
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
