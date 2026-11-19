# Security Policy & On-Chain Invariants

## Core Non-Custodial Model

Interpres separates **off-chain counterparty negotiation** from **on-chain asset settlement**:

1. **Zero Key Custody:** Negotiation agents never hold wallet private keys, seed phrases, or unilateral token transfer authority.
2. **Bounded Per-Order Allowances:** Principals grant exact per-order ERC-20 allowances (`baseAmount` for sellers, `quoteAmount` for buyers) directly to `InterpresEscrow.sol` — never unlimited `uint256.max` approvals.
3. **Immutable Fee Ceiling:** `InterpresEscrow.sol` enforces an immutable constant `MAX_FEE_BPS = 50` (`0.50%`) that no owner transaction can exceed.
4. **Post-Fee Seller Net Guarantee:** Every order snapshots `appliedFeeBps` at creation and enforces `quoteAmount - feeAmount >= minSellerNetAmount` both when creating and when fulfilling an order.
5. **Zero Fee on Cancel or Expiry:** Protocol fees accrue strictly upon completed atomic fulfillment (`fulfillOrder`). Cancelled or unfulfilled orders return `100%` of escrowed base tokens to the seller.
6. **Fee-on-Transfer & Reentrancy Guards:** Both `InterpresEscrow.sol` and `InterpresSlotPayment.sol` enforce `nonReentrant` locks and exact pre/post `balanceOf` delta checks, rejecting fee-on-transfer or rebasing balance discrepancies.

## Deployed Contracts (Robinhood Chain · `4663`)

- **`InterpresEscrow`:** [`0x681ac9d671c612164068592fe2be7b945f3126ec`](https://robinhoodchain.blockscout.com/address/0x681ac9d671c612164068592fe2be7b945f3126ec)
- **`InterpresSlotPayment`:** [`0xeaaaf98e25733387facc93d7e215a9ec19415217`](https://robinhoodchain.blockscout.com/address/0xeaaaf98e25733387facc93d7e215a9ec19415217)

## Reporting a Vulnerability

Please report security findings privately via direct message to [@Interpres_rbh](https://x.com/Interpres_rbh) before public disclosure. Include reproduction steps, affected contract or SDK module, and impact assessment.
