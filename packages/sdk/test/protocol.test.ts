import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEPLOYED_CONTRACTS,
  ROBINHOOD_CHAIN,
  areMandatesCompatible,
  buildSiweMessage,
  calculateSettlementBreakdown,
  clampProposalToMandate,
  formatTokenUnits,
  minGrossForSellerNet,
  parseTokenUnits,
  simulateBoundedNegotiation,
  toPublicProjection,
  validateAgreementConstraints,
  type PrivateMandate,
} from "../src/index.ts";

describe("@interpres/sdk — Settlement Math, Bounded Negotiation & Robinhood Chain Invariants", () => {
  it("computes exact 20 bps and 10 bps settlement breakdowns in integer base units", () => {
    const gross = parseTokenUnits("1000", 6); // 1,000.000000 USDG
    const base = calculateSettlementBreakdown(gross, 20);
    assert.equal(base.protocolFee, 2_000_000n); // 2.00 USDG
    assert.equal(base.sellerNet, 998_000_000n); // 998.00 USDG

    const holder = calculateSettlementBreakdown(gross, 10);
    assert.equal(holder.protocolFee, 1_000_000n); // 1.00 USDG
    assert.equal(holder.sellerNet, 999_000_000n); // 999.00 USDG
  });

  it("enforces immutable MAX_FEE_BPS = 50 ceiling", () => {
    assert.throws(() => calculateSettlementBreakdown(1_000_000n, 51), /outside allowed/);
    const check = validateAgreementConstraints({
      quoteGross: 1_000_000n,
      feeBps: 75,
      sellerMinNet: 900_000n,
      buyerMaxGross: 1_100_000n,
    });
    assert.equal(check.valid, false);
    assert.equal(check.reason, "INVALID_FEE_BPS");
  });

  it("rejects gross quotes that fall below seller post-fee net floor", () => {
    // Seller requires 1,000 USDG NET; offering 1,000 USDG GROSS yields 998 USDG NET -> must reject
    const rejected = validateAgreementConstraints({
      quoteGross: parseTokenUnits("1000", 6),
      feeBps: 20,
      sellerMinNet: parseTokenUnits("1000", 6),
      buyerMaxGross: parseTokenUnits("1050", 6),
    });
    assert.equal(rejected.valid, false);
    assert.equal(rejected.reason, "BELOW_SELLER_NET_MINIMUM");

    const exactMinGross = minGrossForSellerNet(parseTokenUnits("1000", 6), 20);
    const accepted = validateAgreementConstraints({
      quoteGross: exactMinGross,
      feeBps: 20,
      sellerMinNet: parseTokenUnits("1000", 6),
      buyerMaxGross: exactMinGross,
    });
    assert.equal(accepted.valid, true);
    assert.ok(accepted.breakdown!.sellerNet >= parseTokenUnits("1000", 6));

    // One base unit lower must fail net floor
    const oneUnitBelow = calculateSettlementBreakdown(exactMinGross - 1n, 20);
    assert.ok(oneUnitBelow.sellerNet < parseTokenUnits("1000", 6));
  });

  it("clamps out-of-bounds proposals to hard principal reservation limits", () => {
    const sellerMinNet = parseTokenUnits("12500", 6);
    const clampedSell = clampProposalToMandate({
      side: "SELL",
      proposedGrossRaw: parseTokenUnits("11000", 6),
      limitQuoteRaw: sellerMinNet,
      feeBps: 20,
    });
    assert.ok(calculateSettlementBreakdown(clampedSell, 20).sellerNet >= sellerMinNet);

    const buyerMaxGross = parseTokenUnits("12850", 6);
    const clampedBuy = clampProposalToMandate({
      side: "BUY",
      proposedGrossRaw: parseTokenUnits("14000", 6),
      limitQuoteRaw: buyerMaxGross,
      feeBps: 20,
    });
    assert.equal(clampedBuy, buyerMaxGross);
  });

  it("blocks self-matching and redacts private thresholds from public projections", () => {
    const seller: PrivateMandate = {
      id: "m-sell-1",
      ownerWallet: "0x1111111111111111111111111111111111111111",
      side: "SELL",
      baseToken: DEPLOYED_CONTRACTS.weth,
      quoteToken: DEPLOYED_CONTRACTS.usdg,
      quantityRaw: parseTokenUnits("5", 18),
      limitQuoteRaw: parseTokenUnits("12480", 6),
      strategy: "balanced",
      maxRounds: 5,
    };

    const selfBuyer: PrivateMandate = {
      ...seller,
      id: "m-buy-self",
      side: "BUY",
      limitQuoteRaw: parseTokenUnits("12900", 6),
    };
    assert.equal(areMandatesCompatible(seller, selfBuyer, 20), false);

    const pub = toPublicProjection(seller) as Record<string, unknown>;
    assert.equal("limitQuoteRaw" in pub, false);
    assert.equal("strategy" in pub, false);
    assert.equal("ownerWallet" in pub, false);
  });

  it("converges compatible WETH/USDG mandates within both principals' limits", () => {
    const seller: PrivateMandate = {
      id: "seller-weth",
      ownerWallet: "0x1111111111111111111111111111111111111111",
      side: "SELL",
      baseToken: DEPLOYED_CONTRACTS.weth,
      quoteToken: DEPLOYED_CONTRACTS.usdg,
      quantityRaw: parseTokenUnits("5", 18),
      limitQuoteRaw: parseTokenUnits("12480", 6),
      strategy: "balanced",
      maxRounds: 5,
    };
    const buyer: PrivateMandate = {
      id: "buyer-weth",
      ownerWallet: "0x2222222222222222222222222222222222222222",
      side: "BUY",
      baseToken: DEPLOYED_CONTRACTS.weth,
      quoteToken: DEPLOYED_CONTRACTS.usdg,
      quantityRaw: parseTokenUnits("5", 18),
      limitQuoteRaw: parseTokenUnits("12890", 6),
      strategy: "balanced",
      maxRounds: 5,
    };

    const sim = simulateBoundedNegotiation(seller, buyer, 20);
    assert.equal(sim.compatible, true);
    assert.equal(sim.agreed, true);
    assert.ok(sim.finalBreakdown !== null);
    assert.ok(sim.finalBreakdown.sellerNet >= seller.limitQuoteRaw);
    assert.ok(sim.finalBreakdown.grossQuote <= buyer.limitQuoteRaw);
    assert.equal(formatTokenUnits(parseTokenUnits("5", 18), 18), "5");
  });

  it("formats canonical EIP-4361 SIWE messages for Robinhood Chain (4663)", () => {
    const msg = buildSiweMessage({
      domain: "interpres.tech",
      address: "0x1111111111111111111111111111111111111111",
      statement: "Sign in to Interpres Autonomous OTC Protocol.",
      uri: "https://interpres.tech",
      nonce: "a9f3e2c18b47d60512ef9834ab76cd01",
      issuedAt: "2026-11-19T12:00:00.000Z",
      expirationTime: "2026-11-19T12:10:00.000Z",
    });
    assert.ok(msg.includes(`Chain ID: ${ROBINHOOD_CHAIN.chainId}`));
    assert.ok(msg.includes("interpres.tech wants you to sign in"));
  });
});
