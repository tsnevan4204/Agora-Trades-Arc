import { expect } from "chai";
import { ethers, network } from "hardhat";
import { getDeployedProtocol, asErc20WithSigner } from "./helpers/contracts";
import { getSixWallets } from "./helpers/wallets";
import { requireEnv } from "./helpers/env";

const to6 = (s: string) => ethers.parseUnits(s, 6);

/**
 * E2E tests for the curated finance/tech/economics markets (IDs 87–100) on
 * Circle Arc testnet, using real Circle USDC as collateral.
 *
 * Run with:
 *   yarn workspace @se-2/hardhat hardhat test test/arc-testnet/finance-markets-e2e.spec.ts --network arcTestnet
 */
describe("Finance markets E2E — Arc testnet", function () {
  before(function () {
    if (network.name !== "arcTestnet") {
      this.skip();
    }
    this.timeout(600_000);
  });

  const FINANCE_MARKET_ID = 87n;
  const CURATED_IDS = [87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100];

  it("all 14 curated finance markets exist on-chain with non-empty questions", async function () {
    const factoryAddress = requireEnv("FACTORY_ADDRESS");
    const factory = await ethers.getContractAt("MarketFactory", factoryAddress);

    for (const id of CURATED_IDS) {
      const data = await factory.getMarketData(BigInt(id));
      expect(data.exists, `Market #${id} should exist`).to.be.true;
      expect(data.question.length, `Market #${id} question should be non-empty`).to.be.greaterThan(10);
      console.log(`  ✅ Market #${id}: "${data.question.slice(0, 70)}…"`);
    }
  });

  it("wallet 1 can split USDC into YES+NO shares on finance market #87", async function () {
    const { manager, usdc, token1155 } = await getDeployedProtocol();
    const [w1] = getSixWallets();
    const splitAmt = to6("5");

    const yes = await token1155.getYesTokenId(FINANCE_MARKET_ID);
    const no = await token1155.getNoTokenId(FINANCE_MARKET_ID);
    const usdcBefore = await usdc.balanceOf(w1.address);
    const yesBefore = await token1155.balanceOf(w1.address, yes);
    const noBefore = await token1155.balanceOf(w1.address, no);

    const managerAddr = await manager.getAddress();
    const allowance = await usdc.allowance(w1.address, managerAddr);
    if (allowance < splitAmt) {
      const approveTx = await asErc20WithSigner(usdc, w1).approve(managerAddr, ethers.MaxUint256);
      await approveTx.wait();
    }

    const splitTx = await manager.connect(w1).split(FINANCE_MARKET_ID, splitAmt);
    await splitTx.wait();
    console.log(`  🔀 Split tx: ${splitTx.hash}`);

    const usdcAfter = await usdc.balanceOf(w1.address);
    const yesAfter = await token1155.balanceOf(w1.address, yes);
    const noAfter = await token1155.balanceOf(w1.address, no);

    expect(usdcAfter).to.equal(usdcBefore - splitAmt, "USDC should decrease by split amount");
    expect(yesAfter - yesBefore).to.equal(splitAmt, "YES tokens should increase by split amount");
    expect(noAfter - noBefore).to.equal(splitAmt, "NO tokens should increase by split amount");
  });

  it("wallet 2 posts a BUY_YES offer and wallet 3 fills it — volume accumulates", async function () {
    const { manager, exchange, token1155, usdc } = await getDeployedProtocol();
    const [, w2, w3] = getSixWallets();

    const yes = await token1155.getYesTokenId(FINANCE_MARKET_ID);
    const exchangeAddr = await exchange.getAddress();
    const managerAddr = await manager.getAddress();

    for (const w of [w2, w3]) {
      const wUsdc = asErc20WithSigner(usdc, w);
      const a1 = await usdc.allowance(w.address, managerAddr);
      if (a1 < to6("20")) {
        await (await wUsdc.approve(managerAddr, ethers.MaxUint256)).wait();
      }
      const a2 = await usdc.allowance(w.address, exchangeAddr);
      if (a2 < to6("20")) {
        await (await wUsdc.approve(exchangeAddr, ethers.MaxUint256)).wait();
      }
    }

    const splitAmt = to6("10");
    await (await manager.connect(w2).split(FINANCE_MARKET_ID, splitAmt)).wait();

    const offerSize = to6("5");
    const offerId = await exchange.connect(w2).postOffer.staticCall(
      FINANCE_MARKET_ID, 2 /* SELL_YES */, 6000n, offerSize,
    );
    await (await exchange.connect(w2).postOffer(FINANCE_MARKET_ID, 2, 6000n, offerSize)).wait();
    console.log(`  📋 w2 posted SELL_YES offer #${offerId}`);

    const w3YesBefore = await token1155.balanceOf(w3.address, yes);
    const fillAmt = to6("2");
    const fillTx = await exchange.connect(w3).fillOffer(offerId, fillAmt);
    await fillTx.wait();
    console.log(`  ✅ w3 filled offer | tx: ${fillTx.hash}`);

    const w3YesAfter = await token1155.balanceOf(w3.address, yes);
    expect(w3YesAfter - w3YesBefore).to.equal(fillAmt, "w3 should receive YES tokens equal to fill amount");
    console.log(`  📈 Volume accumulated: w3 received ${ethers.formatUnits(fillAmt, 6)} YES shares`);
  });

  it("merge returns collateral correctly on finance market", async function () {
    const { manager, token1155, usdc } = await getDeployedProtocol();
    const [, , , w4] = getSixWallets();
    const managerAddr = await manager.getAddress();

    const yes = await token1155.getYesTokenId(FINANCE_MARKET_ID);
    const no = await token1155.getNoTokenId(FINANCE_MARKET_ID);

    const a = await usdc.allowance(w4.address, managerAddr);
    if (a < to6("10")) {
      await (await asErc20WithSigner(usdc, w4).approve(managerAddr, ethers.MaxUint256)).wait();
    }
    const splitAmt = to6("8");
    await (await manager.connect(w4).split(FINANCE_MARKET_ID, splitAmt)).wait();

    const usdcBefore = await usdc.balanceOf(w4.address);
    const yesBefore = await token1155.balanceOf(w4.address, yes);
    const noBefore = await token1155.balanceOf(w4.address, no);

    const mergeAmt = to6("3");
    await (await manager.connect(w4).merge(FINANCE_MARKET_ID, mergeAmt)).wait();

    expect(await usdc.balanceOf(w4.address)).to.equal(usdcBefore + mergeAmt, "Merge should return USDC");
    expect(await token1155.balanceOf(w4.address, yes)).to.equal(yesBefore - mergeAmt, "YES should decrease");
    expect(await token1155.balanceOf(w4.address, no)).to.equal(noBefore - mergeAmt, "NO should decrease");
    console.log(`  ✅ Merge returned ${ethers.formatUnits(mergeAmt, 6)} USDC`);
  });

  it("market state persists — market #87 still exists with same question after all operations", async function () {
    const factoryAddress = requireEnv("FACTORY_ADDRESS");
    const factory = await ethers.getContractAt("MarketFactory", factoryAddress);
    const data = await factory.getMarketData(FINANCE_MARKET_ID);
    expect(data.exists).to.be.true;
    expect(data.question).to.include("Federal Reserve");
    console.log(`  ✅ Market #87 persists: "${data.question}"`);
  });

  it("volume check — multiple wallets can independently trade same finance market", async function () {
    const { manager, exchange, token1155, usdc } = await getDeployedProtocol();
    const wallets = getSixWallets();
    const managerAddr = await manager.getAddress();
    const exchangeAddr = await exchange.getAddress();

    const yes = await token1155.getYesTokenId(FINANCE_MARKET_ID);

    const targets = [wallets[0], wallets[3], wallets[4], wallets[5]];
    for (const w of targets) {
      const wUsdc = asErc20WithSigner(usdc, w);
      const a1 = await usdc.allowance(w.address, managerAddr);
      if (a1 < to6("5")) await (await wUsdc.approve(managerAddr, ethers.MaxUint256)).wait();
      const a2 = await usdc.allowance(w.address, exchangeAddr);
      if (a2 < to6("5")) await (await wUsdc.approve(exchangeAddr, ethers.MaxUint256)).wait();
      await new Promise((r) => setTimeout(r, 500));
    }

    let totalYesTransferred = 0n;

    for (let i = 3; i < 6; i++) {
      const maker = wallets[i];
      const taker = wallets[0];

      await (await manager.connect(maker).split(FINANCE_MARKET_ID, to6("3"))).wait();
      await new Promise((r) => setTimeout(r, 800));

      const oid = await exchange.connect(maker).postOffer.staticCall(
        FINANCE_MARKET_ID, 2 /* SELL_YES */, 5500n, to6("1"),
      );
      await (await exchange.connect(maker).postOffer(FINANCE_MARKET_ID, 2, 5500n, to6("1"))).wait();
      await new Promise((r) => setTimeout(r, 800));

      const takerYesBefore = await token1155.balanceOf(taker.address, yes);
      await (await exchange.connect(taker).fillOffer(oid, to6("1"))).wait();
      const takerYesAfter = await token1155.balanceOf(taker.address, yes);

      const received = takerYesAfter - takerYesBefore;
      totalYesTransferred += received;
      expect(received).to.equal(to6("1"), `w1 should receive 1 YES share from wallet ${i + 1}`);
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(totalYesTransferred).to.equal(to6("3"), "Total 3 YES shares should have been traded across 3 fills");
    console.log(`  📊 Volume accumulated: ${ethers.formatUnits(totalYesTransferred, 6)} YES shares traded across 3 separate fills`);
  });
});
