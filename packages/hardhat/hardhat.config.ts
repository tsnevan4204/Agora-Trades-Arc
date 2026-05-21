import * as dotenv from "dotenv";
import { resolve } from "path";
dotenv.config({ path: resolve(__dirname, "../../.env") });
dotenv.config({ path: resolve(__dirname, ".env") });

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import "hardhat-deploy-ethers";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || String(v).trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

// Single string → @nomicfoundation/hardhat-verify uses Etherscan API v2 (api.etherscan.io/v2) with chainid.
const etherscanV2ApiKey = requireEnv("ETHERSCAN_V2_API_KEY");

function getDeployerAccounts(): string[] {
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (raw === undefined || String(raw).trim() === "") {
    return [];
  }
  const pk = String(raw).trim();
  const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY is set but invalid: expected 32 bytes as hex (64 hex characters), optional 0x prefix.",
    );
  }
  return [normalized];
}

const deployerAccounts = getDeployerAccounts();

const config: HardhatUserConfig = {
  paths: {
    // Default `hardhat test` runs the live Arc testnet suite only.
    tests: "./test/arc-testnet",
  },
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  defaultNetwork: "arcTestnet",
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  networks: {
    // Hardhat requires this entry even though we never run a local chain.
    hardhat: {},
    arcTestnet: {
      url: requireEnv("ARC_TESTNET_RPC_URL"),
      accounts: deployerAccounts,
      chainId: 5042002,
    },
  },
  etherscan: {
    apiKey: etherscanV2ApiKey,
  },
  verify: {
    etherscan: {
      apiKey: etherscanV2ApiKey,
    },
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
