import { expect } from "chai";
import { ethers, network } from "hardhat";
import { getDeployedProtocol, defaultMarketId, asErc20WithSigner } from "./helpers/contracts";
import { getSixWallets } from "./helpers/wallets";

const to6 = (s: string) => ethers.parseUnits(s, 6);

/**
 * Multi-wallet flows on live Arc testnet deployment (requires MANAGER_ADDRESS, EXCHANGE_ADDRESS, USDC_ADDRESS).
 * Assumes 00-fund-six-wallets already ran (or balances already sufficient).
 */
describe("Arc testnet — six-wallet stress & edge cases", function () {
  before(function () {
    if (network.name !== "arcTestnet") {
      this.skip();
    }
    this.timeout(900_000);
  });

  it("all six wallets approve manager + exchange (max uint)", async function () {
    const { manager, exchange, usdc } = await getDeployedProtocol();
    const managerAddr = await manager.getAddress();
    const exchangeAddr = await exchange.getAddress();
    const wallets = getSixWallets();

    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i];
      const c = asErc20WithSigner(usdc, w);
      const t1 = await c.approve(managerAddr, ethers.MaxUint256);
      await t1.wait();
      const t2 = await c.approve(exchangeAddr, ethers.MaxUint256);
      await t2.wait();
      console.log(`✅ approvals wallet ${i + 1} ${w.address}`);
    }
  });

  it("sequential micro-splits from all six wallets (no cross-wallet interference)", async function () {
    const { manager } = await getDeployedProtocol();
    const wallets = getSixWallets();
    const marketId = defaultMarketId();
    const amount = to6("0.5");

    for (let i = 0; i < wallets.length; i++) {
      const tx = await manager.connect(wallets[i]).split(marketId, amount);
      await tx.wait();
    }

    const outcome = await manager.outcomeToken();
    const token1155 = await ethers.getContractAt("OutcomeToken1155", outcome);
    const yes = await token1155.getYesTokenId(marketId);
    const no = await token1155.getNoTokenId(marketId);

    for (let i = 0; i < wallets.length; i++) {
      const w = wallets[i].address;
      expect(await token1155.balanceOf(w, yes)).to.be.gte(amount);
      expect(await token1155.balanceOf(w, no)).to.be.gte(amount);
    }
  });

  it("one SELL_YES offer fully filled by three different takers (partial fills)", async function () {
    const { manager, exchange, token1155 } = await getDeployedProtocol();
    const [w1, , , w4, w5, w6] = getSixWallets();
    const marketId = defaultMarketId();
    const lot = to6("12");

    await (await manager.connect(w1).split(marketId, lot)).wait();
    const offerId = await exchange.connect(w1).postOffer.staticCall(marketId, 2, 6100, lot);
    await (await exchange.connect(w1).postOffer(marketId, 2, 6100, lot)).wait();

    await (await exchange.connect(w4).fillOffer(offerId, to6("4"))).wait();
    await (await exchange.connect(w5).fillOffer(offerId, to6("3"))).wait();
    await (await exchange.connect(w6).fillOffer(offerId, to6("5"))).wait();

    const o = await exchange.offers(offerId);
    expect(o.remainingAmount).to.equal(0n);
    expect(o.status).to.equal(2);

    const yes = await token1155.getYesTokenId(marketId);
    const w4Yes = await token1155.balanceOf(w4.address, yes);
    expect(w4Yes).to.be.gte(to6("4"));
  });

  it("SELL_NO book: maker and taker on outcome NO side", async function () {
    const { manager, exchange, token1155 } = await getDeployedProtocol();
    const [, w2, w3] = getSixWallets();
    const marketId = defaultMarketId();
    const amt = to6("6");

    const no = await token1155.getNoTokenId(marketId);
    const w3NoBefore = await token1155.balanceOf(w3.address, no);

    await (await manager.connect(w2).split(marketId, amt)).wait();
    const offerId = await exchange.connect(w2).postOffer.staticCall(marketId, 3, 5200, amt);
    await (await exchange.connect(w2).postOffer(marketId, 3, 5200, amt)).wait();
    await (await exchange.connect(w3).fillOffer(offerId, to6("2"))).wait();

    const w3NoAfter = await token1155.balanceOf(w3.address, no);
    expect(w3NoAfter - w3NoBefore).to.equal(to6("2"));
  });

  it("reverts self-fill on maker’s own SELL_YES", async function () {
    const { manager, exchange } = await getDeployedProtocol();
    const [w1] = getSixWallets();
    const marketId = defaultMarketId();
    const amt = to6("3");
    await (await manager.connect(w1).split(marketId, amt)).wait();
    const offerId = await exchange.connect(w1).postOffer.staticCall(marketId, 2, 6000, amt);
    await (await exchange.connect(w1).postOffer(marketId, 2, 6000, amt)).wait();

    await expect(exchange.connect(w1).fillOffer(offerId, to6("1"))).to.be.revertedWithCustomError(
      exchange,
      "Exchange__SelfFillNotAllowed",
    );
  });

  it("merge burns paired inventory back to collateral after split", async function () {
    const { manager, token1155, usdc } = await getDeployedProtocol();
    const [, , w3] = getSixWallets();
    const marketId = defaultMarketId();
    const splitAmt = to6("20");
    const mergeAmt = to6("7");

    const collateralBefore = await usdc.balanceOf(w3.address);
    const yes = await token1155.getYesTokenId(marketId);
    const no = await token1155.getNoTokenId(marketId);
    const yesBefore = await token1155.balanceOf(w3.address, yes);
    const noBefore = await token1155.balanceOf(w3.address, no);

    await (await manager.connect(w3).split(marketId, splitAmt)).wait();
    expect(await usdc.balanceOf(w3.address)).to.equal(collateralBefore - splitAmt);
    expect(await token1155.balanceOf(w3.address, yes)).to.equal(yesBefore + splitAmt);
    expect(await token1155.balanceOf(w3.address, no)).to.equal(noBefore + splitAmt);

    await (await manager.connect(w3).merge(marketId, mergeAmt)).wait();
    expect(await token1155.balanceOf(w3.address, yes)).to.equal(yesBefore + splitAmt - mergeAmt);
    expect(await token1155.balanceOf(w3.address, no)).to.equal(noBefore + splitAmt - mergeAmt);
    expect(await usdc.balanceOf(w3.address)).to.equal(collateralBefore - splitAmt + mergeAmt);
  });

  it("reverts merge when signer has no outcome inventory (deployer, not a test wallet)", async function () {
    const { manager } = await getDeployedProtocol();
    const [deployer] = await ethers.getSigners();
    const marketId = defaultMarketId();

    await expect(manager.connect(deployer).merge(marketId, to6("1"))).to.be.reverted;
  });

  it("reverts postOffer when BUY quote rounds to zero (dust)", async function () {
    const { exchange } = await getDeployedProtocol();
    const [w1] = getSixWallets();
    const marketId = defaultMarketId();

    await expect(exchange.connect(w1).postOffer(marketId, 0, 1, 1)).to.be.revertedWithCustomError(
      exchange,
      "Exchange__QuoteTooSmall",
    );
  });

  it("round-robin: six wallets each post tiny SELL_YES then next wallet fills 1 unit", async function () {
    const { manager, exchange, token1155 } = await getDeployedProtocol();
    const wallets = getSixWallets();
    const marketId = defaultMarketId();
    const tiny = to6("2");
    const yes = await token1155.getYesTokenId(marketId);

    for (const w of wallets) {
      await (await manager.connect(w).split(marketId, tiny)).wait();
    }

    for (let i = 0; i < wallets.length; i++) {
      const maker = wallets[i];
      const taker = wallets[(i + 1) % wallets.length];
      const takerYesBefore = await token1155.balanceOf(taker.address, yes);
      const oid = await exchange.connect(maker).postOffer.staticCall(marketId, 2, 5800, to6("1"));
      await (await exchange.connect(maker).postOffer(marketId, 2, 5800, to6("1"))).wait();
      await (await exchange.connect(taker).fillOffer(oid, to6("1"))).wait();
      const takerYesAfter = await token1155.balanceOf(taker.address, yes);
      expect(takerYesAfter - takerYesBefore).to.equal(to6("1"));
    }
  });
});
