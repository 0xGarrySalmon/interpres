// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Minimal, SafeTransferLib, ReentrancyGuardMinimal} from "./InterpresEscrow.sol";

/**
 * @title InterpresSlotPayment
 * @notice Processes explicit, non-recurring ERC-20 slot entitlement purchases (0.20 USDG / 30 days)
 *         tied to unique anti-replay paymentIntentIds on Robinhood Chain (4663).
 */
contract InterpresSlotPayment is ReentrancyGuardMinimal {
    using SafeTransferLib for IERC20Minimal;

    address public owner;
    address public treasury;
    address public paymentToken;
    uint256 public slotPrice;
    uint256 public slotDurationSeconds;
    bool public paused;

    mapping(bytes32 => bool) public consumedIntents;

    error Unauthorized();
    error InvalidAddress();
    error InvalidPrice();
    error InvalidIntentId();
    error PaymentPaused();
    error IntentAlreadyConsumed(bytes32 intentId);
    error UnsupportedFeeOnTransferToken();

    event SlotPaymentCompleted(
        bytes32 indexed paymentIntentId,
        address indexed payer,
        address indexed token,
        uint256 amount,
        uint256 durationSeconds,
        uint256 timestamp
    );

    event SlotPlanUpdated(address paymentToken, uint256 slotPrice, uint256 slotDurationSeconds, address treasury);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address _treasury,
        address _paymentToken,
        uint256 _slotPrice,
        uint256 _slotDurationSeconds
    ) {
        if (_treasury == address(0) || _paymentToken == address(0)) revert InvalidAddress();
        if (_slotPrice == 0 || _slotDurationSeconds == 0) revert InvalidPrice();
        owner = msg.sender;
        treasury = _treasury;
        paymentToken = _paymentToken;
        slotPrice = _slotPrice;
        slotDurationSeconds = _slotDurationSeconds;
    }

    function purchaseExtraSlot(bytes32 paymentIntentId) external nonReentrant {
        if (paused) revert PaymentPaused();
        if (paymentIntentId == bytes32(0)) revert InvalidIntentId();
        if (consumedIntents[paymentIntentId]) revert IntentAlreadyConsumed(paymentIntentId);

        consumedIntents[paymentIntentId] = true;

        IERC20Minimal token = IERC20Minimal(paymentToken);
        uint256 beforeBal = token.balanceOf(treasury);
        token.safeTransferFrom(msg.sender, treasury, slotPrice);
        if (token.balanceOf(treasury) - beforeBal != slotPrice) {
            revert UnsupportedFeeOnTransferToken();
        }

        emit SlotPaymentCompleted(
            paymentIntentId,
            msg.sender,
            paymentToken,
            slotPrice,
            slotDurationSeconds,
            block.timestamp
        );
    }

    function updatePlan(
        address _paymentToken,
        uint256 _slotPrice,
        uint256 _slotDurationSeconds,
        address _treasury
    ) external onlyOwner {
        if (_treasury == address(0) || _paymentToken == address(0)) revert InvalidAddress();
        if (_slotPrice == 0 || _slotDurationSeconds == 0) revert InvalidPrice();
        paymentToken = _paymentToken;
        slotPrice = _slotPrice;
        slotDurationSeconds = _slotDurationSeconds;
        treasury = _treasury;
        emit SlotPlanUpdated(_paymentToken, _slotPrice, _slotDurationSeconds, _treasury);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
}
