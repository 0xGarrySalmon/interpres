import {
  calculateSettlementBreakdown,
  formatTokenUnits,
  minGrossForSellerNet,
  parseTokenUnits,
  validateAgreementConstraints,
} from "../packages/sdk/src/index.ts";

const sellerMinNet = parseTokenUnits("12500", 6); // 12,500.000000 USDG post-fee floor

for (const feeBps of [20, 10]) {
  const minGross = minGrossForSellerNet(sellerMinNet, feeBps);
  const bd = calculateSettlementBreakdown(minGross, feeBps);
  const check = validateAgreementConstraints({
    quoteGross: minGross,
    feeBps,
    sellerMinNet,
    buyerMaxGross: parseTokenUnits("12600", 6),
  });

  console.log(`=== Tier ${feeBps} bps ===`);
  console.log(`Required Seller Net:   ${formatTokenUnits(sellerMinNet, 6)} USDG`);
  console.log(`Minimum Gross Quote:   ${formatTokenUnits(minGross, 6)} USDG`);
  console.log(`Protocol Fee:          ${formatTokenUnits(bd.protocolFee, 6)} USDG`);
  console.log(`Verified Seller Net:   ${formatTokenUnits(bd.sellerNet, 6)} USDG`);
  console.log(`Constraint Validated:  ${check.valid}\n`);
}
