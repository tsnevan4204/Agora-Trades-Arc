import path from 'path'
import { fileURLToPath } from 'url'
import nextEnv from '@next/env'

const { loadEnvConfig } = nextEnv

const appDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(appDir, '../..')

// Monorepo: share repo-root `.env` with Hardhat/backend; frontend overrides in `.env.local`.
loadEnvConfig(repoRoot)
loadEnvConfig(appDir)

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Yarn workspace monorepo: trace files from the repo root so Next can find
  // the workspace's package.json layout.
  outputFileTracingRoot: path.join(appDir, '../..'),
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
