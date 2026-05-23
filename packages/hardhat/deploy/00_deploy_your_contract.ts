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

  const ZERO = "0x0000000000000000000000000000000000000000";

  const configuredManager = (await read("OutcomeToken1155", "manager")) as string;
  if (configuredManager === ZERO) {
    await execute("OutcomeToken1155", { from: deployer, log: true }, "setManager", manager.address);
  }

  const configuredExchange = (await read("OutcomeToken1155", "exchange")) as string;
  if (configuredExchange === ZERO) {
    await execute("OutcomeToken1155", { from: deployer, log: true }, "setExchange", exchange.address);
  }

  // Post-deploy consistency check. OutcomeToken1155.setManager/setExchange can
  // only be called once (subsequent calls revert with __AlreadySet). If we
  // redeploy Manager or Exchange without also redeploying OutcomeToken1155,
  // the token keeps trusting the stale addresses and every split/merge/redeem
  // reverts with OutcomeToken1155__OnlyManager(). Fail loudly here instead of
  // shipping a broken set of contracts to the frontend.
  const finalManager = ((await read("OutcomeToken1155", "manager")) as string).toLowerCase();
  const finalExchange = ((await read("OutcomeToken1155", "exchange")) as string).toLowerCase();
  const expectedManager = manager.address.toLowerCase();
  const expectedExchange = exchange.address.toLowerCase();

  const managerOk = finalManager === expectedManager;
  const exchangeOk = finalExchange === expectedExchange;

  if (!managerOk || !exchangeOk) {
    console.error("\n❌ OutcomeToken1155 wiring is out of sync with the deployed Manager/Exchange:");
    if (!managerOk) {
      console.error(`   token.manager()  = ${finalManager}`);
      console.error(`   expected manager = ${expectedManager}`);
    }
    if (!exchangeOk) {
      console.error(`   token.exchange()  = ${finalExchange}`);
      console.error(`   expected exchange = ${expectedExchange}`);
    }
    console.error(
      "\nOutcomeToken1155 can only have its manager/exchange set once. To recover,\n" +
        `delete deployments/${network}/OutcomeToken1155.json (and ideally the\n` +
        "PredictionMarketManager + Exchange artifacts too) and re-run `yarn deploy`.\n" +
        "Any existing on-chain markets created via the stale Factory/Manager are\n" +
        "stranded; you'll need to recreate them through the admin flow.\n",
    );
    throw new Error("OutcomeToken1155 wiring mismatch — refusing to sync stale addresses to frontend.");
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
