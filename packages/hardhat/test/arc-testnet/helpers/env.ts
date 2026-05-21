export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing ${name} (required for Arc testnet tests). Loaded from repo root .env via Hardhat.`);
  }
  return v;
}

export function normalizePrivateKey(pk: string): string {
  const t = pk.trim();
  const hex = t.startsWith("0x") ? t : `0x${t}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Invalid private key: expected 32-byte hex (optional 0x prefix).");
  }
  return hex;
}
