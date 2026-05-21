import path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

/**
 * Resolve an output directory for generated contract artifacts.
 * - Default is relative to `packages/hardhat` (`hre.config.paths.root`).
 * - Set env to an absolute path, or a path relative to the Hardhat package root.
 */
function resolveOutputDir(
  hre: HardhatRuntimeEnvironment,
  envKey: "AGORA_FRONTEND_CONTRACTS_DIR" | "AGORA_BACKEND_CONTRACTS_DIR",
  defaultRelativeFromHardhatPackage: string,
): string {
  const override = process.env[envKey]?.trim();
  const root = hre.config.paths.root;
  if (!override) {
    return path.resolve(root, defaultRelativeFromHardhatPackage);
  }
  return path.isAbsolute(override) ? override : path.resolve(root, override);
}

/** Where `deployedContracts.ts` is written (Agora Next app). Default: ../AgoraFrontEnd/contracts */
export function agoraFrontendContractsDir(hre: HardhatRuntimeEnvironment): string {
  return resolveOutputDir(hre, "AGORA_FRONTEND_CONTRACTS_DIR", "../AgoraFrontEnd/contracts");
}

/** Where `manifest.json` is written (Python relayer). Default: ../backend/app/contracts */
export function agoraBackendContractsDir(hre: HardhatRuntimeEnvironment): string {
  return resolveOutputDir(hre, "AGORA_BACKEND_CONTRACTS_DIR", "../backend/app/contracts");
}
