#!/usr/bin/env node
import {
  DEPLOYED_CONTRACTS,
  INTP_TIERS,
  ROBINHOOD_CHAIN,
  calculateSettlementBreakdown,
  formatTokenUnits,
  minGrossForSellerNet,
  parseTokenUnits,
  simulateBoundedNegotiation,
} from "../../sdk/src/index.ts";

const [, , cmd = "help", ...args] = process.argv;

if (cmd === "contracts") {
  console.log(`\nInterpres Protocol — ${ROBINHOOD_CHAIN.name} (Chain ID: ${ROBINHOOD_CHAIN.chainId})`);
  console.log(`RPC:               ${ROBINHOOD_CHAIN.rpcUrl}`);
  console.log(`Explorer:          ${ROBINHOOD_CHAIN.explorerUrl}`);
  console.log(`InterpresEscrow:   ${DEPLOYED_CONTRACTS.escrow}`);
  console.log(`SlotPayment:       ${DEPLOYED_CONTRACTS.slotPayment}`);
  console.log(`USDG (6 dec):      ${DEPLOYED_CONTRACTS.usdg}`);
  console.log(`WETH (18 dec):     ${DEPLOYED_CONTRACTS.weth}\n`);
} else if (cmd === "tiers") {
  console.log("\n$INTP Hold-to-Unlock Protocol Tiers:\n");
  for (const t of INTP_TIERS) {
    console.log(
      `  ${t.tier.padEnd(8)} | min ${String(t.minIntpTokens).padStart(6)} $INTP | Fee: ${t.settlementFeeBps} bps (${(t.settlementFeeBps / 100).toFixed(2)}%) | Concurrent Slots: ${t.includedSlots}`,
    );
  }
  console.log("");
} else if (cmd === "quote") {
  const grossStr = args[0] ?? "12820";
  const bps = Number(args[1] ?? "20");
  const gross = parseTokenUnits(grossStr, 6);
  const bd = calculateSettlementBreakdown(gross, bps);
  const minGross = minGrossForSellerNet(gross, bps);
  console.log(`\nQuote Breakdown (${bps} bps):`);
  console.log(`  Buyer Pays (Gross):        ${formatTokenUnits(bd.grossQuote, 6)} USDG`);
  console.log(`  Protocol Fee (${bps} bps):     ${formatTokenUnits(bd.protocolFee, 6)} USDG`);
  console.log(`  Seller Receives (Net):     ${formatTokenUnits(bd.sellerNet, 6)} USDG`);
  console.log(`  Min Gross for ${grossStr} Net: ${formatTokenUnits(minGross, 6)} USDG\n`);
} else if (cmd === "simulate") {
  const qty = args[0] ?? "5";
  const sellerFloor = args[1] ?? "12480";
  const buyerCap = args[2] ?? "12890";
  const res = simulateBoundedNegotiation(
    {
      id: "cli-seller",
      ownerWallet: "0x1111111111111111111111111111111111111111",
      side: "SELL",
      baseToken: DEPLOYED_CONTRACTS.weth,
      quoteToken: DEPLOYED_CONTRACTS.usdg,
      quantityRaw: parseTokenUnits(qty, 18),
      limitQuoteRaw: parseTokenUnits(sellerFloor, 6),
      strategy: "balanced",
      maxRounds: 5,
    },
    {
      id: "cli-buyer",
      ownerWallet: "0x2222222222222222222222222222222222222222",
      side: "BUY",
      baseToken: DEPLOYED_CONTRACTS.weth,
      quoteToken: DEPLOYED_CONTRACTS.usdg,
      quantityRaw: parseTokenUnits(qty, 18),
      limitQuoteRaw: parseTokenUnits(buyerCap, 6),
      strategy: "balanced",
      maxRounds: 5,
    },
    20,
  );
  console.log(`\nSimulated ${qty} WETH <-> USDG OTC Session (Compatible: ${res.compatible}, Agreed: ${res.agreed}):`);
  for (const t of res.turns) {
    console.log(
      `  [Round ${t.round}] ${t.actor.padEnd(4)} ${t.action.padEnd(7)} -> Gross: ${formatTokenUnits(t.quoteGrossRaw, 6)} USDG | Net: ${formatTokenUnits(t.breakdown.sellerNet, 6)} USDG`,
    );
  }
  console.log("");
} else {
  console.log(`
Interpres CLI (@interpres/cli)

Usage:
  npm run cli -- contracts                           Print deployed Robinhood Chain (4663) contracts
  npm run cli -- tiers                               Print $INTP fee & concurrent slot tiers
  npm run cli -- quote <grossUsdg> [feeBps]          Compute exact bigint fee & seller net proceeds
  npm run cli -- simulate [wethQty] [minNet] [max]   Simulate bounded multi-round OTC convergence
`);
}
