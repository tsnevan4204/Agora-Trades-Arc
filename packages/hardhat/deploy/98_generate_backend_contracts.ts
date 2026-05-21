/**
 * This file is part of the hardhat deploy pipeline.
 * It reads compiled deployment artifacts and writes a Python-consumable
 * contract manifest to the backend contracts dir (default: ../backend/app/contracts/manifest.json).
 *
 * The manifest contains ABIs, deployed addresses per network, and
 * pre-computed function selectors for the relayer allowlist.
 *
 * Run via: yarn deploy (runs all deploy scripts in order)
 */

import { DeployFunction } from "hardhat-deploy/types";
import { Interface } from "ethers";
import * as fs from "fs";
import * as path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { agoraBackendContractsDir } from "../utils/paths";

const DEPLOYMENTS_DIR = "./deployments";

const RELAYER_ALLOWED_FUNCTIONS: Record<string, string[]> = {
  PredictionMarketManager: ["split", "merge", "redeem"],
  Exchange: ["postOffer", "fillOffer", "cancelOffer"],
};

function getNetworkDirs(): string[] {
  if (!fs.existsSync(DEPLOYMENTS_DIR)) return [];
  return fs
    .readdirSync(DEPLOYMENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function getContractNames(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith(".json") && d.name !== ".chainId")
    .map(d => d.name.replace(".json", ""));
}

interface ContractEntry {
  address: string;
  abi: any[];
}

interface NetworkEntry {
  chainId: string;
  contracts: Record<string, ContractEntry>;
}

interface SelectorEntry {
  name: string;
  selector: string;
  contract: string;
}

function computeSelectors(contractName: string, abi: any[], allowedFunctions: string[]): SelectorEntry[] {
  const iface = new Interface(abi);
  const entries: SelectorEntry[] = [];
  for (const fnName of allowedFunctions) {
    try {
      const fragment = iface.getFunction(fnName);
      if (fragment) {
        entries.push({
          name: fnName,
          selector: fragment.selector,
          contract: contractName,
        });
      }
    } catch {
      console.warn(`  ⚠ selector not found: ${contractName}.${fnName}`);
    }
  }
  return entries;
}

const syncBackendContracts: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const backendContractsDir = agoraBackendContractsDir(hre);
  const networks: Record<string, NetworkEntry> = {};
  const allAbis: Record<string, any[]> = {};

  for (const networkName of getNetworkDirs()) {
    const chainIdFile = path.join(DEPLOYMENTS_DIR, networkName, ".chainId");
    if (!fs.existsSync(chainIdFile)) continue;
    const chainId = fs.readFileSync(chainIdFile, "utf-8").trim();
    const contractDir = path.join(DEPLOYMENTS_DIR, networkName);
    const contracts: Record<string, ContractEntry> = {};

    for (const name of getContractNames(contractDir)) {
      const artifact = JSON.parse(fs.readFileSync(path.join(contractDir, `${name}.json`), "utf-8"));
      contracts[name] = {
        address: artifact.address,
        abi: artifact.abi,
      };
      allAbis[name] = artifact.abi;
    }

    networks[chainId] = { chainId, contracts };
  }

  const selectors: SelectorEntry[] = [];
  for (const [contractName, fnNames] of Object.entries(RELAYER_ALLOWED_FUNCTIONS)) {
    const abi = allAbis[contractName];
    if (abi) {
      selectors.push(...computeSelectors(contractName, abi, fnNames));
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    networks,
    relayerAllowedSelectors: selectors,
  };

  if (!fs.existsSync(backendContractsDir)) {
    fs.mkdirSync(backendContractsDir, { recursive: true });
  }

  const outPath = path.join(backendContractsDir, "manifest.json");
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`📝 Updated backend contract manifest at ${outPath}`);
};

export default syncBackendContracts;
syncBackendContracts.tags = ["sync-backend"];
syncBackendContracts.runAtTheEnd = true;
