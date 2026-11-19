// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

library SafeTransferLib {
    error ERC20TransferFailed();
    error ETHTransferFailed();
    error NotAContract();

    function safeTransfer(IERC20Minimal token, address to, uint256 value) internal {
        if (address(token).code.length == 0) revert NotAContract();
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transfer.selector, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert ERC20TransferFailed();
        }
    }

    function safeTransferFrom(IERC20Minimal token, address from, address to, uint256 value) internal {
        if (address(token).code.length == 0) revert NotAContract();
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert ERC20TransferFailed();
        }
    }

    function safeTransferETH(address to, uint256 value) internal {
        if (value == 0) return;
        (bool success, ) = to.call{value: value}("");
        if (!success) revert ETHTransferFailed();
    }
}

abstract contract ReentrancyGuardMinimal {
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private _status = NOT_ENTERED;

    error ReentrancyDetected();

    modifier nonReentrant() {
        if (_status == ENTERED) revert ReentrancyDetected();
        _status = ENTERED;
        _;
        _status = NOT_ENTERED;
    }
}

/**
 * @title InterpresEscrow
 * @notice Fixed-price, full-fill atomic Native ETH & ERC-20 OTC settlement for Interpres Protocol.
 *         Supports both native ETH (`NATIVE_ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`)
 *         and standard ERC-20 tokens as either `baseToken` or `quoteToken`.
 */
contract InterpresEscrow is ReentrancyGuardMinimal {
    using SafeTransferLib for IERC20Minimal;

    address public constant NATIVE_ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_FEE_BPS = 50; // 0.50% hard protocol ceiling

    enum OrderStatus {
        None,
        Open,
        Fulfilled,
        Cancelled
    }

    struct Order {
        address seller;
        address designatedBuyer; // address(0) = open to any counterparty
        address baseToken;
        address quoteToken;
        uint256 baseAmount;
        uint256 quoteAmount;
        uint256 minSellerNetAmount;
        uint16 appliedFeeBps; // Snapshotted at creation; immune to later fee/tier changes
        uint64 createdAt;
        uint64 expiresAt;
        OrderStatus status;
    }

    address public owner;
    address public pendingOwner;
    address public treasury;
    address public intpToken;
    uint256 public holderThreshold;
    uint16 public baseFeeBps;
    uint16 public holderFeeBps;
    uint256 public nextOrderId = 1;

    mapping(uint256 => Order) public orders;

    error Unauthorized();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidMsgValue();
    error IdenticalTokens();
    error InvalidExpiry();
    error FeeExceedsHardCap(uint16 provided, uint16 maxAllowed);
    error HolderFeeExceedsBaseFee();
    error SellerNetFloorViolated(uint256 actualSellerNet, uint256 minSellerNetRequired);
    error OrderNotOpen();
    error OrderExpired();
    error UnauthorizedBuyer();
    error SelfFulfillmentForbidden();
    error UnsupportedFeeOnTransferToken();

    event OrderCreated(
        uint256 indexed orderId,
        address indexed seller,
        address indexed designatedBuyer,
        address baseToken,
        address quoteToken,
        uint256 baseAmount,
        uint256 quoteAmount,
        uint16 appliedFeeBps,
        uint256 minSellerNetAmount,
        uint64 expiresAt
    );

    event OrderFulfilled(
        uint256 indexed orderId,
        address indexed seller,
        address indexed buyer,
        uint256 baseAmount,
        uint256 quoteGrossAmount,
        uint256 protocolFeeAmount,
        uint256 sellerNetAmount,
        uint16 appliedFeeBps
    );

    event OrderCancelled(uint256 indexed orderId, address indexed seller, uint256 returnedBaseAmount);

    event ProtocolFeeCollected(
        uint256 indexed orderId,
        address indexed quoteToken,
        address indexed treasury,
        uint256 feeAmount,
        uint16 feeBps
    );

    event FeeConfigUpdated(uint16 baseFeeBps, uint16 holderFeeBps, address treasury);
    event IntpEligibilityUpdated(address intpToken, uint256 holderThreshold);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address _treasury,
        uint16 _baseFeeBps,
        uint16 _holderFeeBps,
        address _intpToken,
        uint256 _holderThreshold
    ) {
        if (_treasury == address(0)) revert InvalidAddress();
        if (_baseFeeBps > MAX_FEE_BPS) revert FeeExceedsHardCap(_baseFeeBps, MAX_FEE_BPS);
        if (_holderFeeBps > _baseFeeBps) revert HolderFeeExceedsBaseFee();

        owner = msg.sender;
        treasury = _treasury;
        baseFeeBps = _baseFeeBps;
        holderFeeBps = _holderFeeBps;
        intpToken = _intpToken;
        holderThreshold = _holderThreshold;
    }

    function previewSettlement(uint256 quoteAmount, uint16 feeBps)
        public
        pure
        returns (uint256 feeAmount, uint256 sellerNetAmount)
    {
        if (feeBps > MAX_FEE_BPS) revert FeeExceedsHardCap(feeBps, MAX_FEE_BPS);
        feeAmount = (quoteAmount * uint256(feeBps)) / uint256(BPS_DENOMINATOR);
        sellerNetAmount = quoteAmount - feeAmount;
    }

    function getApplicableFeeBps(address sellerAccount) public view returns (uint16) {
        if (intpToken != address(0) && holderThreshold > 0) {
            uint256 bal = IERC20Minimal(intpToken).balanceOf(sellerAccount);
            if (bal >= holderThreshold) {
                return holderFeeBps;
            }
        }
        return baseFeeBps;
    }

    function createOrder(
        address baseToken,
        address quoteToken,
        uint256 baseAmount,
        uint256 quoteAmount,
        uint256 minSellerNetAmount,
        uint64 expiresAt,
        address designatedBuyer
    ) external payable nonReentrant returns (uint256 orderId) {
        if (baseToken == address(0) || quoteToken == address(0)) revert InvalidAddress();
        if (baseToken == quoteToken) revert IdenticalTokens();
        if (baseAmount == 0 || quoteAmount == 0) revert InvalidAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (designatedBuyer == msg.sender) revert SelfFulfillmentForbidden();

        uint16 appliedFee = getApplicableFeeBps(msg.sender);
        (, uint256 sellerNet) = previewSettlement(quoteAmount, appliedFee);
        if (sellerNet < minSellerNetAmount) {
            revert SellerNetFloorViolated(sellerNet, minSellerNetAmount);
        }

        if (baseToken == NATIVE_ETH) {
            if (msg.value != baseAmount) revert InvalidMsgValue();
        } else {
            if (msg.value != 0) revert InvalidMsgValue();
            IERC20Minimal base = IERC20Minimal(baseToken);
            uint256 balBefore = base.balanceOf(address(this));
            base.safeTransferFrom(msg.sender, address(this), baseAmount);
            if (base.balanceOf(address(this)) - balBefore != baseAmount) {
                revert UnsupportedFeeOnTransferToken();
            }
        }

        orderId = nextOrderId++;
        Order storage ord = orders[orderId];
        ord.seller = msg.sender;
        ord.designatedBuyer = designatedBuyer;
        ord.baseToken = baseToken;
        ord.quoteToken = quoteToken;
        ord.baseAmount = baseAmount;
        ord.quoteAmount = quoteAmount;
        ord.minSellerNetAmount = minSellerNetAmount;
        ord.appliedFeeBps = appliedFee;
        ord.createdAt = uint64(block.timestamp);
        ord.expiresAt = expiresAt;
        ord.status = OrderStatus.Open;

        emit OrderCreated(
            orderId,
            ord.seller,
            ord.designatedBuyer,
            ord.baseToken,
            ord.quoteToken,
            ord.baseAmount,
            ord.quoteAmount,
            ord.appliedFeeBps,
            ord.minSellerNetAmount,
            ord.expiresAt
        );
    }

    function fulfillOrder(uint256 orderId) external payable nonReentrant {
        Order storage ord = orders[orderId];
        if (ord.status != OrderStatus.Open) revert OrderNotOpen();
        if (block.timestamp >= ord.expiresAt) revert OrderExpired();
        if (msg.sender == ord.seller) revert SelfFulfillmentForbidden();
        if (ord.designatedBuyer != address(0) && msg.sender != ord.designatedBuyer) {
            revert UnauthorizedBuyer();
        }

        (uint256 feeAmount, uint256 sellerNet) = previewSettlement(ord.quoteAmount, ord.appliedFeeBps);
        if (sellerNet < ord.minSellerNetAmount) {
            revert SellerNetFloorViolated(sellerNet, ord.minSellerNetAmount);
        }

        // Effects before external interactions
        ord.status = OrderStatus.Fulfilled;

        if (ord.quoteToken == NATIVE_ETH) {
            if (msg.value != ord.quoteAmount) revert InvalidMsgValue();
            SafeTransferLib.safeTransferETH(ord.seller, sellerNet);
            if (feeAmount > 0) {
                SafeTransferLib.safeTransferETH(treasury, feeAmount);
                emit ProtocolFeeCollected(orderId, ord.quoteToken, treasury, feeAmount, ord.appliedFeeBps);
            }
        } else {
            if (msg.value != 0) revert InvalidMsgValue();
            IERC20Minimal quote = IERC20Minimal(ord.quoteToken);

            uint256 sellerBefore = quote.balanceOf(ord.seller);
            quote.safeTransferFrom(msg.sender, ord.seller, sellerNet);
            if (quote.balanceOf(ord.seller) - sellerBefore != sellerNet) {
                revert UnsupportedFeeOnTransferToken();
            }

            if (feeAmount > 0) {
                uint256 treasBefore = quote.balanceOf(treasury);
                quote.safeTransferFrom(msg.sender, treasury, feeAmount);
                if (quote.balanceOf(treasury) - treasBefore != feeAmount) {
                    revert UnsupportedFeeOnTransferToken();
                }
                emit ProtocolFeeCollected(orderId, ord.quoteToken, treasury, feeAmount, ord.appliedFeeBps);
            }
        }

        if (ord.baseToken == NATIVE_ETH) {
            SafeTransferLib.safeTransferETH(msg.sender, ord.baseAmount);
        } else {
            IERC20Minimal(ord.baseToken).safeTransfer(msg.sender, ord.baseAmount);
        }

        emit OrderFulfilled(
            orderId,
            ord.seller,
            msg.sender,
            ord.baseAmount,
            ord.quoteAmount,
            feeAmount,
            sellerNet,
            ord.appliedFeeBps
        );
    }

    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage ord = orders[orderId];
        if (ord.status != OrderStatus.Open) revert OrderNotOpen();
        if (msg.sender != ord.seller) revert Unauthorized();

        ord.status = OrderStatus.Cancelled;

        if (ord.baseToken == NATIVE_ETH) {
            SafeTransferLib.safeTransferETH(ord.seller, ord.baseAmount);
        } else {
            IERC20Minimal(ord.baseToken).safeTransfer(ord.seller, ord.baseAmount);
        }

        emit OrderCancelled(orderId, ord.seller, ord.baseAmount);
    }

    function updateFeeConfig(uint16 _baseFeeBps, uint16 _holderFeeBps, address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidAddress();
        if (_baseFeeBps > MAX_FEE_BPS) revert FeeExceedsHardCap(_baseFeeBps, MAX_FEE_BPS);
        if (_holderFeeBps > _baseFeeBps) revert HolderFeeExceedsBaseFee();
        baseFeeBps = _baseFeeBps;
        holderFeeBps = _holderFeeBps;
        treasury = _treasury;
        emit FeeConfigUpdated(_baseFeeBps, _holderFeeBps, _treasury);
    }

    function updateIntpEligibility(address _intpToken, uint256 _holderThreshold) external onlyOwner {
        intpToken = _intpToken;
        holderThreshold = _holderThreshold;
        emit IntpEligibilityUpdated(_intpToken, _holderThreshold);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address prev = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(prev, owner);
    }
}
