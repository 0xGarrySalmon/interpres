import { PROTOCOL_PARAMS } from "./constants.ts";

export interface SettlementBreakdown {
  grossQuote: bigint;
  feeBps: number;
  protocolFee: bigint;
  sellerNet: bigint;
}

export interface ConstraintValidation {
  valid: boolean;
  reason?: "INVALID_FEE_BPS" | "ZERO_QUOTE" | "BELOW_SELLER_NET_MINIMUM" | "EXCEEDS_BUYER_MAXIMUM";
  breakdown?: SettlementBreakdown;
}

/**
 * Parses a human decimal token string (e.g. "12820.50") into exact integer base units.
 */
export function parseTokenUnits(human: string, decimals: number): bigint {
  const cleaned = human.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid positive token amount: "${human}"`);
  }
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > decimals) {
    throw new Error(`Fractional precision (${frac.length}) exceeds token decimals (${decimals})`);
  }
  const paddedFrac = frac.padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFrac || "0");
}

/**
 * Formats integer base units into a clean human-readable decimal string.
 */
export function formatTokenUnits(raw: bigint | string, decimals: number, maxFracDigits = 6): string {
  const val = typeof raw === "string" ? BigInt(raw) : raw;
  if (val < 0n) throw new Error("Negative token units are not supported");
  const base = 10n ** BigInt(decimals);
  const whole = val / base;
  const frac = val % base;
  if (frac === 0n || decimals === 0) return whole.toString();
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFracDigits)
    .replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
}

/**
 * Mirrors InterpresEscrow.previewSettlement exact integer math:
 *   protocolFee = floor((grossQuote * feeBps) / 10_000)
 *   sellerNet   = grossQuote - protocolFee
 */
export function calculateSettlementBreakdown(
  grossQuote: bigint,
  feeBps: number,
): SettlementBreakdown {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > PROTOCOL_PARAMS.maxFeeBps) {
    throw new Error(`Fee bps (${feeBps}) outside allowed [0, ${PROTOCOL_PARAMS.maxFeeBps}] range`);
  }
  if (grossQuote < 0n) {
    throw new Error("Gross quote cannot be negative");
  }
  const protocolFee = (grossQuote * BigInt(feeBps)) / PROTOCOL_PARAMS.bpsDenominator;
  const sellerNet = grossQuote - protocolFee;
  return { grossQuote, feeBps, protocolFee, sellerNet };
}

/**
 * Computes the exact smallest gross quote `G` such that:
 *   G - floor(G * feeBps / 10_000) >= sellerMinNet
 */
export function minGrossForSellerNet(sellerMinNet: bigint, feeBps: number): bigint {
  if (sellerMinNet <= 0n) return 0n;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > PROTOCOL_PARAMS.maxFeeBps) {
    throw new Error(`Invalid fee bps: ${feeBps}`);
  }
  if (feeBps === 0) return sellerMinNet;

  const keepBps = PROTOCOL_PARAMS.bpsDenominator - BigInt(feeBps);
  let candidate = (sellerMinNet * PROTOCOL_PARAMS.bpsDenominator + keepBps - 1n) / keepBps;

  while (calculateSettlementBreakdown(candidate, feeBps).sellerNet < sellerMinNet) {
    candidate += 1n;
  }
  while (
    candidate > 1n &&
    calculateSettlementBreakdown(candidate - 1n, feeBps).sellerNet >= sellerMinNet
  ) {
    candidate -= 1n;
  }
  return candidate;
}

/**
 * Validates that a candidate gross quote simultaneously satisfies:
 *   1. Immutable protocol fee cap (<= 50 bps)
 *   2. Seller post-fee net floor (`sellerNet >= sellerMinNet`)
 *   3. Buyer gross spend ceiling (`quoteGross <= buyerMaxGross`)
 */
export function validateAgreementConstraints(params: {
  quoteGross: bigint;
  feeBps: number;
  sellerMinNet: bigint;
  buyerMaxGross: bigint;
}): ConstraintValidation {
  const { quoteGross, feeBps, sellerMinNet, buyerMaxGross } = params;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > PROTOCOL_PARAMS.maxFeeBps) {
    return { valid: false, reason: "INVALID_FEE_BPS" };
  }
  if (quoteGross <= 0n) {
    return { valid: false, reason: "ZERO_QUOTE" };
  }
  if (quoteGross > buyerMaxGross) {
    return { valid: false, reason: "EXCEEDS_BUYER_MAXIMUM" };
  }
  const breakdown = calculateSettlementBreakdown(quoteGross, feeBps);
  if (breakdown.sellerNet < sellerMinNet) {
    return { valid: false, reason: "BELOW_SELLER_NET_MINIMUM", breakdown };
  }
  return { valid: true, breakdown };
}
