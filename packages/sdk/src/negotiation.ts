import {
  calculateSettlementBreakdown,
  minGrossForSellerNet,
  validateAgreementConstraints,
  type SettlementBreakdown,
} from "./math.ts";

export type MandateSide = "SELL" | "BUY";
export type ConcessionStrategy = "conservative" | "balanced" | "aggressive";

export interface PrivateMandate {
  id: string;
  ownerWallet: string;
  side: MandateSide;
  baseToken: string;
  quoteToken: string;
  quantityRaw: bigint;
  /** Seller: minimum post-fee net receive. Buyer: maximum gross spend. */
  limitQuoteRaw: bigint;
  strategy: ConcessionStrategy;
  maxRounds: number;
}

export interface PublicMandateProjection {
  id: string;
  side: MandateSide;
  baseToken: string;
  quoteToken: string;
  quantityRaw: string;
}

export interface NegotiationTurn {
  round: number;
  actor: MandateSide;
  action: "OPEN" | "COUNTER" | "ACCEPT";
  quoteGrossRaw: bigint;
  breakdown: SettlementBreakdown;
}

export interface SimulationResult {
  compatible: boolean;
  agreed: boolean;
  feeBps: number;
  turns: NegotiationTurn[];
  finalBreakdown: SettlementBreakdown | null;
}

const OPENING_MARKUP_BPS: Record<ConcessionStrategy, bigint> = {
  conservative: 900n, // +9.0% opening spread from reservation limit
  balanced: 650n,     // +6.5%
  aggressive: 400n,   // +4.0%
};

/**
 * Strips private reservation thresholds (`limitQuoteRaw`, `strategy`, `ownerWallet`)
 * before broadcasting an intent to the public discovery topology.
 */
export function toPublicProjection(mandate: PrivateMandate): PublicMandateProjection {
  return {
    id: mandate.id,
    side: mandate.side,
    baseToken: mandate.baseToken,
    quoteToken: mandate.quoteToken,
    quantityRaw: mandate.quantityRaw.toString(),
  };
}

/**
 * Checks whether a Seller and Buyer mandate can converge in principle without
 * self-matching or violating the Seller's post-fee net minimum.
 */
export function areMandatesCompatible(
  seller: PrivateMandate,
  buyer: PrivateMandate,
  feeBps: number,
): boolean {
  if (seller.side !== "SELL" || buyer.side !== "BUY") return false;
  if (seller.ownerWallet.toLowerCase() === buyer.ownerWallet.toLowerCase()) return false;
  if (seller.baseToken.toLowerCase() !== buyer.baseToken.toLowerCase()) return false;
  if (seller.quoteToken.toLowerCase() !== buyer.quoteToken.toLowerCase()) return false;
  if (seller.quantityRaw <= 0n || seller.quantityRaw !== buyer.quantityRaw) return false;

  const minGrossRequired = minGrossForSellerNet(seller.limitQuoteRaw, feeBps);
  return buyer.maxRounds > 0 && seller.maxRounds > 0 && buyer.limitQuoteRaw >= minGrossRequired;
}

/**
 * Clamps any candidate quote (e.g. proposed by an external model) so it can NEVER
 * violate the acting principal's hard reservation boundary.
 */
export function clampProposalToMandate(params: {
  side: MandateSide;
  proposedGrossRaw: bigint;
  limitQuoteRaw: bigint;
  feeBps: number;
}): bigint {
  const { side, proposedGrossRaw, limitQuoteRaw, feeBps } = params;
  if (side === "SELL") {
    const hardMinGross = minGrossForSellerNet(limitQuoteRaw, feeBps);
    return proposedGrossRaw < hardMinGross ? hardMinGross : proposedGrossRaw;
  }
  return proposedGrossRaw > limitQuoteRaw ? limitQuoteRaw : proposedGrossRaw;
}

/**
 * Runs a deterministic multi-round bounded concession session between a Seller and Buyer mandate.
 * Neither party sees the counterparty's `limitQuoteRaw`; each concedes along its own curve.
 */
export function simulateBoundedNegotiation(
  seller: PrivateMandate,
  buyer: PrivateMandate,
  feeBps: number,
): SimulationResult {
  const compatible = areMandatesCompatible(seller, buyer, feeBps);
  if (!compatible) {
    return { compatible: false, agreed: false, feeBps, turns: [], finalBreakdown: null };
  }

  const maxRounds = Math.min(seller.maxRounds, buyer.maxRounds);
  const sellerHardMinGross = minGrossForSellerNet(seller.limitQuoteRaw, feeBps);
  const buyerHardMaxGross = buyer.limitQuoteRaw;

  const sellerStart =
    sellerHardMinGross + (sellerHardMinGross * OPENING_MARKUP_BPS[seller.strategy]) / 10_000n;
  const buyerStartRaw =
    buyerHardMaxGross - (buyerHardMaxGross * OPENING_MARKUP_BPS[buyer.strategy]) / 10_000n;
  const buyerStart = buyerStartRaw > 0n ? buyerStartRaw : 1n;

  const turns: NegotiationTurn[] = [];
  let lastSellerAsk = sellerStart;
  let lastBuyerBid = buyerStart;

  for (let round = 1; round <= maxRounds; round++) {
    const progressBps = BigInt(Math.round((round / maxRounds) * 10_000));

    // Seller turn
    const sellerSpan = sellerStart - sellerHardMinGross;
    const sellerTarget = clampProposalToMandate({
      side: "SELL",
      proposedGrossRaw: sellerStart - (sellerSpan * progressBps) / 10_000n,
      limitQuoteRaw: seller.limitQuoteRaw,
      feeBps,
    });

    if (round > 1 && lastBuyerBid >= sellerTarget) {
      const check = validateAgreementConstraints({
        quoteGross: lastBuyerBid,
        feeBps,
        sellerMinNet: seller.limitQuoteRaw,
        buyerMaxGross: buyerHardMaxGross,
      });
      if (check.valid && check.breakdown) {
        turns.push({
          round,
          actor: "SELL",
          action: "ACCEPT",
          quoteGrossRaw: lastBuyerBid,
          breakdown: check.breakdown,
        });
        return { compatible: true, agreed: true, feeBps, turns, finalBreakdown: check.breakdown };
      }
    }

    lastSellerAsk = sellerTarget;
    turns.push({
      round,
      actor: "SELL",
      action: round === 1 ? "OPEN" : "COUNTER",
      quoteGrossRaw: lastSellerAsk,
      breakdown: calculateSettlementBreakdown(lastSellerAsk, feeBps),
    });

    // Buyer turn
    const buyerSpan = buyerHardMaxGross - buyerStart;
    const buyerTarget = clampProposalToMandate({
      side: "BUY",
      proposedGrossRaw: buyerStart + (buyerSpan * progressBps) / 10_000n,
      limitQuoteRaw: buyer.limitQuoteRaw,
      feeBps,
    });

    if (lastSellerAsk <= buyerTarget) {
      const clearing = (lastSellerAsk + buyerTarget) / 2n;
      const check = validateAgreementConstraints({
        quoteGross: clearing,
        feeBps,
        sellerMinNet: seller.limitQuoteRaw,
        buyerMaxGross: buyerHardMaxGross,
      });
      if (check.valid && check.breakdown) {
        turns.push({
          round,
          actor: "BUY",
          action: "ACCEPT",
          quoteGrossRaw: clearing,
          breakdown: check.breakdown,
        });
        return { compatible: true, agreed: true, feeBps, turns, finalBreakdown: check.breakdown };
      }
    }

    lastBuyerBid = buyerTarget;
    turns.push({
      round,
      actor: "BUY",
      action: round === 1 ? "OPEN" : "COUNTER",
      quoteGrossRaw: lastBuyerBid,
      breakdown: calculateSettlementBreakdown(lastBuyerBid, feeBps),
    });
  }

  return { compatible: true, agreed: false, feeBps, turns, finalBreakdown: null };
}
