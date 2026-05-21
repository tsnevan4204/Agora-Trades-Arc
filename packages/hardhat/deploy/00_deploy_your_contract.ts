import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Canonical Circle USDC ERC-20 on Arc testnet.
 * Source: https://docs.arc.network/arc/references/contract-addresses
 * 6 decimals; doubles as native gas via Arc's dual-interface model.
 */
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

const deployYourContract: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute, read } = hre.deployments;
  const network = hre.network.name;

  if (network !== "arcTestnet" && !process.env.USDC_ADDRESS?.trim()) {
    throw new Error(
      `Deployment requires --network arcTestnet (received "${network}"). ` +
        `If you really need to deploy to another network, set USDC_ADDRESS in env first.`,
    );
  }

  const collateralAddress = (process.env.USDC_ADDRESS?.trim() || ARC_TESTNET_USDC);
  console.log(`🌐 Network: ${network}`);
  console.log(`💵 Collateral (USDC): ${collateralAddress}`);

  const metadataBaseUri = process.env.OUTCOME_TOKEN_BASE_URI || "https://agora.example/metadata/{id}.json";

  const forwarder = await deploy("AgoraForwarder", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });

  const factory = await deploy("MarketFactory", {
    from: deployer,
    args: [deployer, collateralAddress],
    log: true,
    autoMine: true,
  });

  const token1155 = await deploy("OutcomeToken1155", {
    from: deployer,
    args: [metadataBaseUri, deployer],
    log: true,
    autoMine: true,
  });

  const manager = await deploy("PredictionMarketManager", {
    from: deployer,
    args: [deployer, forwarder.address, collateralAddress, factory.address, token1155.address, deployer],
    log: true,
    autoMine: true,
  });

  const exchange = await deploy("Exchange", {
    from: deployer,
    args: [deployer, forwarder.address, collateralAddress, token1155.address, manager.address],
    log: true,
    autoMine: true,
  });

  const configuredManager = (await read("OutcomeToken1155", "manager")) as string;
  if (configuredManager === "0x0000000000000000000000000000000000000000") {
    await execute("OutcomeToken1155", { from: deployer, log: true }, "setManager", manager.address);
  }

  const configuredExchange = (await read("OutcomeToken1155", "exchange")) as string;
  if (configuredExchange === "0x0000000000000000000000000000000000000000") {
    await execute("OutcomeToken1155", { from: deployer, log: true }, "setExchange", exchange.address);
  }

  console.log("Deployed forwarder:", forwarder.address);
  console.log("Collateral (USDC):", collateralAddress);
  console.log("Deployed factory:", factory.address);
  console.log("Deployed token1155:", token1155.address);
  console.log("Deployed manager:", manager.address);
  console.log("Deployed exchange:", exchange.address);
};

export default deployYourContract;
deployYourContract.tags = ["core", "PredictionMarketRefactor"];
