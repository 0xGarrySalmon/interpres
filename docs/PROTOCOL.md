# Interpres Protocol Specification

## 1. Execution Separation

Interpres enforces a strict three-plane boundary across every OTC transaction:

1. **Agent Plane (Off-Chain Proposal):** Software mandates discover compatible ERC-20 counterparties and propose structured counteroffers across capped rounds (`<= 5` by default). Agents never hold private keys or signing rights.
2. **Verification Plane (Deterministic Code):** All monetary quantities are represented in integer token base units (`bigint`). Any candidate quote that violates either principal's private reservation boundary is clamped or rejected deterministically.
3. **Settlement Plane (On-Chain Atomic Escrow):** Assets move exclusively when both principals authorize bounded ERC-20 allowances against `InterpresEscrow.sol` on **Robinhood Chain (`4663`)**.

---

## 2. Basis-Point Fee & Seller Net-Floor Arithmetic

Let:
- $Q_{\text{gross}} \in \mathbb{Z}_{>0}$ denote the buyer's gross quote transfer in quote token base units.
- $f \in [0, 50]$ denote the applicable basis-point fee (`20` bps base, `10` bps eligible `$INTP` holder, `50` bps immutable contract ceiling).
- $S_{\min} \in \mathbb{Z}_{>0}$ denote the seller's private post-fee net reservation floor.
- $B_{\max} \in \mathbb{Z}_{>0}$ denote the buyer's private gross spend ceiling.

`InterpresEscrow.previewSettlement` computes:

$$\text{Fee}(Q_{\text{gross}}, f) = \left\lfloor \frac{Q_{\text{gross}} \cdot f}{10\,000} \right\rfloor, \qquad S_{\text{net}}(Q_{\text{gross}}, f) = Q_{\text{gross}} - \text{Fee}(Q_{\text{gross}}, f)$$

An agreement is valid if and only if:

$$Q_{\text{gross}} \le B_{\max} \quad \land \quad S_{\text{net}}(Q_{\text{gross}}, f) \ge S_{\min}$$

Consequently, if a seller specifies a `1,000.000000 USDG` net floor under a `20 bps` fee, a `1,000.000000 USDG` gross offer yields `998.000000 USDG` net and is rejected both off-chain and on-chain (`SellerNetFloorViolated`). The minimum valid gross quote is `1,002.004009 USDG`.

---

## 3. On-Chain Settlement Lifecycle (`InterpresEscrow.sol`)

1. **Order Creation (`createOrder`):**
   - Snapshots `appliedFeeBps = getApplicableFeeBps(msg.sender)` directly from the seller's on-chain `$INTP` balance. Later balance changes never alter an open order.
   - Verifies `sellerNet >= minSellerNetAmount` before pulling tokens.
   - Transfers exact `baseAmount` into escrow and verifies exact `balanceOf(address(this))` delta (`UnsupportedFeeOnTransferToken` on mismatch).
2. **Atomic Fulfillment (`fulfillOrder`):**
   - Verifies `status == Open`, `block.timestamp < expiresAt`, `msg.sender != seller`, and `designatedBuyer` match (when set).
   - Transfers `sellerNet` quote tokens from buyer to seller, `feeAmount` quote tokens from buyer to protocol treasury, and `baseAmount` escrowed base tokens to buyer in a single atomic transaction.
3. **Zero-Fee Cancellation (`cancelOrder`):**
   - At any time prior to fulfillment, the seller may cancel an open order and reclaim `100%` of escrowed `baseAmount` with zero protocol fee.

---

## 4. Concurrent Agent Slot Entitlements (`InterpresSlotPayment.sol`)

- Every principal receives **3 concurrent active agent slots** free (`10` slots for eligible `$INTP` holders).
- Non-active states (`Draft`, `Paused`, `Completed`, `Cancelled`) consume `0` slots.
- Additional 30-day active slots cost `0.20 USDG` via `purchaseExtraSlot(bytes32 paymentIntentId)`. Consumed `paymentIntentId` hashes are recorded permanently on-chain (`consumedIntents`) to prevent replay.
