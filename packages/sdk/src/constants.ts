export const ROBINHOOD_CHAIN = {
  chainId: 4663,
  chainIdHex: "0x1237",
  name: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
} as const;

export const DEPLOYED_CONTRACTS = {
  escrow: "0x681ac9d671c612164068592fe2be7b945f3126ec",
  slotPayment: "0xeaaaf98e25733387facc93d7e215a9ec19415217",
  nativeEth: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  usdg: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  weth: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
} as const;

export const PROTOCOL_PARAMS = {
  bpsDenominator: 10_000n,
  baseFeeBps: 20,
  holderFeeBps: 10,
  maxFeeBps: 50,
  baseConcurrentSlots: 3,
  holderConcurrentSlots: 10,
  holderThresholdHuman: "10000",
  extraSlotPriceUsdg: "0.20",
  extraSlotDurationDays: 30,
} as const;

export interface IntpTierSpec {
  tier: "BASE" | "HOLDER";
  minIntpTokens: number;
  settlementFeeBps: number;
  includedSlots: number;
}

export const INTP_TIERS: readonly IntpTierSpec[] = [
  {
    tier: "BASE",
    minIntpTokens: 0,
    settlementFeeBps: 20,
    includedSlots: 3,
  },
  {
    tier: "HOLDER",
    minIntpTokens: 10_000,
    settlementFeeBps: 10,
    includedSlots: 10,
  },
] as const;

export const INTERPRES_ESCROW_FUNCTIONS = [
  "function NATIVE_ETH() external view returns (address)",
  "function createOrder(address baseToken, address quoteToken, uint256 baseAmount, uint256 quoteAmount, uint256 minSellerNetAmount, uint64 expiresAt, address designatedBuyer) external payable returns (uint256 orderId)",
  "function fulfillOrder(uint256 orderId) external payable",
  "function cancelOrder(uint256 orderId) external",
  "function previewSettlement(uint256 quoteAmount, uint16 feeBps) external pure returns (uint256 feeAmount, uint256 sellerNetAmount)",
  "function getApplicableFeeBps(address sellerAccount) external view returns (uint16)",
] as const;

export const INTERPRES_SLOT_PAYMENT_FUNCTIONS = [
  "function purchaseExtraSlot(bytes32 paymentIntentId) external",
  "function consumedIntents(bytes32 intentId) external view returns (bool)",
] as const;
