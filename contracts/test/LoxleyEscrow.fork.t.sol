// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ISignatureTransfer} from "permit2/interfaces/ISignatureTransfer.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LoxleyEscrow} from "../src/LoxleyEscrow.sol";
import {Permit2Helper} from "./Permit2Helper.sol";

/// @dev Runs against a live Robinhood Chain fork: real Permit2, real USDG. Skipped when RHC_MAINNET_RPC_URL is unset.
contract LoxleyEscrowForkTest is Permit2Helper {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    LoxleyEscrow internal escrow;
    uint256 internal payerKey = 0xA11CE;
    uint256 internal attestorKey = 0xFAC1;
    address internal payer;
    address internal payee = makeAddr("payee");

    function setUp() public {
        string memory rpc = vm.envOr("RHC_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        escrow = new LoxleyEscrow(PERMIT2, 0, address(0));
        payer = vm.addr(payerKey);
        deal(USDG, payer, 5e6);
        vm.prank(payer);
        IERC20(USDG).approve(PERMIT2, type(uint256).max);
    }

    function test_fork_openAndReleaseWithRealUsdg() public {
        if (address(escrow) == address(0)) return;
        assertEq(block.chainid, 4663);
        bytes32 id = keccak256("fork-req");
        LoxleyEscrow.EscrowWitness memory w = LoxleyEscrow.EscrowWitness({
            requestId: id,
            payee: payee,
            attestor: vm.addr(attestorKey),
            deadline: uint64(block.timestamp + 5 minutes),
            schemaHash: keccak256("schema")
        });
        ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: USDG, amount: 10_000}),
            nonce: 1,
            deadline: block.timestamp + 1 hours
        });
        bytes memory sig = signPermit(
            ISignatureTransfer(PERMIT2), payerKey, permit, address(escrow), witnessHashFor(escrow, w), escrow.WITNESS_TYPE_STRING()
        );
        escrow.open(permit, payer, w, sig);
        assertEq(IERC20(USDG).balanceOf(address(escrow)), 10_000);

        LoxleyEscrow.Receipt memory r =
            LoxleyEscrow.Receipt({requestId: id, responseHash: keccak256("body"), status: 200, accepted: true});
        escrow.release(r, signReceipt(escrow, attestorKey, r));
        assertEq(IERC20(USDG).balanceOf(payee), 10_000);
    }
}
