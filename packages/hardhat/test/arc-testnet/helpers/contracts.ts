import { ethers } from "hardhat";
import type { BaseContract, ContractTransactionResponse, Signer } from "ethers";
import { requireEnv } from "./env";

/** Canonical Circle USDC on Arc testnet (6 decimals). */
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

/** Minimal ERC-20 ABI sufficient for our test surface (balanceOf/allowance/approve/transfer). */
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function transfer(address,uint256) returns (bool)",
];

/**
 * Typed handle to a minimal USDC ERC-20 — `getContractAt(stringAbi, ...)` returns
 * plain `BaseContract`, so we layer the typed method signatures we actually use.
 */
export type Erc20Like = BaseContract & {
  balanceOf(owner: string): Promise<bigint>;
  allowance(owner: string, spender: string): Promise<bigint>;
  approve(spender: string, amount: bigint): Promise<ContractTransactionResponse>;
  transfer(to: string, amount: bigint): Promise<ContractTransactionResponse>;
};

/**
 * Bind the loose `usdc` handle to a signer and re-type it as `Erc20Like` so the
 * call sites can use `.approve(...)` etc. without each one casting manually.
 *
 * `BaseContract.connect` is typed to return `BaseContract`, which strips the
 * ERC-20 method augmentations from the intersection type above.
 */
export function asErc20WithSigner(contract: Erc20Like, signer: Signer): Erc20Like {
  return contract.connect(signer) as unknown as Erc20Like;
}

export async function getDeployedProtocol() {
  const usdcAddress = (process.env.USDC_ADDRESS?.trim() || ARC_TESTNET_USDC);
  const managerAddress = requireEnv("MANAGER_ADDRESS");
  const exchangeAddress = requireEnv("EXCHANGE_ADDRESS");

  const usdc = (await ethers.getContractAt(USDC_ABI, usdcAddress)) as unknown as Erc20Like;
  const manager = await ethers.getContractAt("PredictionMarketManager", managerAddress);
  const exchange = await ethers.getContractAt("Exchange", exchangeAddress);
  const outcomeTokenAddress = await manager.outcomeToken();
  const token1155 = await ethers.getContractAt("OutcomeToken1155", outcomeTokenAddress);

  return {
    usdc,
    manager,
    exchange,
    token1155,
    usdcAddress,
    managerAddress,
    exchangeAddress,
  };
}

/** Default on-chain market used by deployed seed / scenarios. */
export function defaultMarketId(): bigint {
  const raw = process.env.TESTNET_MARKET_ID?.trim();
  if (!raw) return 0n;
  return BigInt(raw);
}
