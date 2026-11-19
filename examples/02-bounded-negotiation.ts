import {
  DEPLOYED_CONTRACTS,
  formatTokenUnits,
  parseTokenUnits,
  simulateBoundedNegotiation,
  toPublicProjection,
  type PrivateMandate,
} from "../packages/sdk/src/index.ts";

const seller: PrivateMandate = {
  id: "mandate-sell-weth",
  ownerWallet: "0x1d16a42ffd65f105ae899562059527A620bD1824",
  side: "SELL",
  baseToken: DEPLOYED_CONTRACTS.weth,
  quoteToken: DEPLOYED_CONTRACTS.usdg,
  quantityRaw: parseTokenUnits("5", 18),
  limitQuoteRaw: parseTokenUnits("12480", 6), // Private post-fee net floor
  strategy: "balanced",
  maxRounds: 5,
};

const buyer: PrivateMandate = {
  id: "mandate-buy-weth",
  ownerWallet: "0x9Ad0D96A6b1114Cb785D9Ff1D31a6B2361cD3BC0",
  side: "BUY",
  baseToken: DEPLOYED_CONTRACTS.weth,
  quoteToken: DEPLOYED_CONTRACTS.usdg,
  quantityRaw: parseTokenUnits("5", 18),
  limitQuoteRaw: parseTokenUnits("12890", 6), // Private gross spend ceiling
  strategy: "balanced",
  maxRounds: 5,
};

console.log("Public Broadcast (Private Limits Redacted):");
console.log("  Seller:", toPublicProjection(seller));
console.log("  Buyer: ", toPublicProjection(buyer));

const session = simulateBoundedNegotiation(seller, buyer, 20);
console.log(`\nBounded Convergence (${session.turns.length} turns, Agreed: ${session.agreed}):`);
for (const turn of session.turns) {
  console.log(
    `  Round ${turn.round} | ${turn.actor.padEnd(4)} ${turn.action.padEnd(7)} | Gross: ${formatTokenUnits(turn.quoteGrossRaw, 6)} USDG | Fee: ${formatTokenUnits(turn.breakdown.protocolFee, 6)} USDG | Seller Net: ${formatTokenUnits(turn.breakdown.sellerNet, 6)} USDG`,
  );
}
