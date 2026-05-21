import { ethers } from "hardhat";
import { Wallet } from "ethers";
import { normalizePrivateKey, requireEnv } from "./env";

export function getSixRecipientAddresses(): string[] {
  const addrs: string[] = [];
  for (let i = 1; i <= 6; i++) {
    addrs.push(requireEnv(`TEST_WALLET_${i}_ADDRESS`));
  }
  return addrs;
}

export function getSixWallets(): Wallet[] {
  const provider = ethers.provider;
  const wallets: Wallet[] = [];
  for (let i = 1; i <= 6; i++) {
    const pk = normalizePrivateKey(requireEnv(`TEST_WALLET_${i}_PRIVATE_KEY`));
    wallets.push(new Wallet(pk, provider));
  }
  return wallets;
}
