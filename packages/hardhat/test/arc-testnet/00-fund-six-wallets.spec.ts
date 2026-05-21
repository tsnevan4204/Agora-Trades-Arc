import { expect } from "chai";
import { ethers, network } from "hardhat";
import { getSixRecipientAddresses } from "./helpers/wallets";

/**
 * Runs first (file name 00-…): asserts that each of the six TEST_WALLET_*
 * addresses already holds ≥ 100 USDC on Arc testnet.
 *
 * Unlike the old MockUSDT flow, real Circle USDC cannot be minted from a
 * script — fund the wallets manually from https://faucet.circle.com before
 * running the suite (USDC doubles as the gas token on Arc, so this also
 * pays for subsequent test transactions).
 */
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

const USDC_ABI = ["function balanceOf(address) view returns (uint256)"];

describe("Arc testnet — 00 preflight: USDC ≥ 100 per wallet", function () {
  before(function () {
    if (network.name !== "arcTestnet") {
      this.skip();
    }
    this.timeout(120_000);
  });

  it("each of the six TEST_WALLET_* addresses holds at least 100 USDC", async function () {
    const usdcAddr = (process.env.USDC_ADDRESS?.trim() || ARC_TESTNET_USDC);
    const recipients = getSixRecipientAddresses();

    const target = ethers.parseUnits("100", 6);
    const usdc = await ethers.getContractAt(USDC_ABI, usdcAddr);

    console.log(`🌐 ${network.name} | USDC ${usdcAddr}`);

    const underfunded: string[] = [];
    for (let i = 0; i < recipients.length; i++) {
      const addr = recipients[i];
      const bal = (await usdc.balanceOf(addr)) as bigint;
      if (bal < target) {
        console.log(`❌ wallet ${i + 1} ${addr} — has ${ethers.formatUnits(bal, 6)} USDC, need 100`);
        underfunded.push(addr);
      } else {
        console.log(`✅ wallet ${i + 1} ${addr} — ${ethers.formatUnits(bal, 6)} USDC`);
      }
    }

    if (underfunded.length > 0) {
      throw new Error(
        `${underfunded.length} wallet(s) under-funded. Fund from https://faucet.circle.com:\n` +
          underfunded.map((a) => `  - ${a}`).join("\n"),
      );
    }

    for (const addr of recipients) {
      const bal = (await usdc.balanceOf(addr)) as bigint;
      expect(bal).to.be.gte(target);
    }
  });
});
