// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {InterpresEscrow} from "../src/InterpresEscrow.sol";
import {InterpresSlotPayment} from "../src/InterpresSlotPayment.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract InterpresEscrowTest {
    InterpresEscrow public escrow;
    InterpresSlotPayment public slotPay;
    MockERC20 public weth;
    MockERC20 public usdg;
    MockERC20 public intp;

    address public treasury = address(0xBEEF);

    constructor() {
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        intp = new MockERC20("Interpres", "INTP", 18);

        escrow = new InterpresEscrow(
            treasury,
            20, // 0.20% base fee
            10, // 0.10% $INTP holder fee
            address(intp),
            10_000 ether
        );

        slotPay = new InterpresSlotPayment(
            treasury,
            address(usdg),
            200_000, // 0.20 USDG (6 decimals)
            30 days
        );
    }

    function testFeePreviewMath() public view {
        (uint256 fee, uint256 net) = escrow.previewSettlement(1_000_000_000, 20);
        require(fee == 2_000_000, "20 bps of 1000 USDG must be 2 USDG");
        require(net == 998_000_000, "Seller net must be 998 USDG");
    }

    function testHolderFeeDiscount() public {
        address holder = address(0xCAFE);
        intp.mint(holder, 10_000 ether);
        require(escrow.getApplicableFeeBps(holder) == 10, "Eligible $INTP holder must receive 10 bps");
        require(escrow.getApplicableFeeBps(address(0xDEAD)) == 20, "Standard user must receive 20 bps");
    }
}
