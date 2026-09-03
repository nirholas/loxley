// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ISignatureTransfer} from "permit2/interfaces/ISignatureTransfer.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LoxleyEscrow} from "../src/LoxleyEscrow.sol";
import {MockUSDG} from "../src/MockUSDG.sol";
import {Permit2Helper} from "./Permit2Helper.sol";

contract LoxleyEscrowTest is Permit2Helper {
    address internal constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    ISignatureTransfer internal permit2;
    MockUSDG internal usdg;
    LoxleyEscrow internal escrow;
    LoxleyEscrow internal feeEscrow;

    uint256 internal payerKey = 0xA11CE;
    uint256 internal attestorKey = 0xFAC1;
    address internal payer;
    address internal attestor;
    address internal payee = makeAddr("payee");
    address internal facilitator = makeAddr("facilitator");
    address internal feeRecipient = makeAddr("fees");

    function setUp() public {
        // Real Permit2 runtime bytecode captured from Robinhood Chain (test/deps/Permit2.runtime.hex),
        // etched at the canonical address so tests hit the same contract production does.
        vm.etch(PERMIT2_ADDR, vm.parseBytes(vm.readFile("test/deps/Permit2.runtime.hex")));
        permit2 = ISignatureTransfer(PERMIT2_ADDR);
        usdg = new MockUSDG(address(this));
        escrow = new LoxleyEscrow(address(permit2), 0, address(0));
        feeEscrow = new LoxleyEscrow(address(permit2), 100, feeRecipient);

        payer = vm.addr(payerKey);
        attestor = vm.addr(attestorKey);
        usdg.mint(payer, 1_000e6);
        vm.prank(payer);
        usdg.approve(address(permit2), type(uint256).max);
    }

    function _open(LoxleyEscrow e, bytes32 requestId, uint256 amount, uint64 deadline, uint256 nonce)
        internal
        returns (LoxleyEscrow.EscrowWitness memory w)
    {
        w = LoxleyEscrow.EscrowWitness({
            requestId: requestId,
            payee: payee,
            attestor: attestor,
            deadline: deadline,
            schemaHash: keccak256("schema:v1")
        });
        ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: address(usdg), amount: amount}),
            nonce: nonce,
            deadline: block.timestamp + 1 hours
        });
        bytes memory sig = signPermit(permit2, payerKey, permit, address(e), witnessHashFor(e, w), e.WITNESS_TYPE_STRING());
        vm.prank(facilitator);
        e.open(permit, payer, w, sig);
    }

    function test_openLocksFunds() public {
        _open(escrow, keccak256("req-1"), 10_000, uint64(block.timestamp + 10 minutes), 1);
        assertEq(usdg.balanceOf(address(escrow)), 10_000);
        assertEq(usdg.balanceOf(payer), 1_000e6 - 10_000);
        LoxleyEscrow.Lock memory l = escrow.getLock(keccak256("req-1"));
        assertEq(uint8(l.status), uint8(LoxleyEscrow.Status.Open));
        assertEq(l.payer, payer);
        assertEq(l.payee, payee);
        assertEq(l.attestor, attestor);
        assertEq(l.amount, 10_000);
    }

    function test_releasePaysPayee() public {
        bytes32 id = keccak256("req-2");
        _open(escrow, id, 10_000, uint64(block.timestamp + 10 minutes), 2);
        LoxleyEscrow.Receipt memory r =
            LoxleyEscrow.Receipt({requestId: id, responseHash: keccak256("body"), status: 200, accepted: true});
        escrow.release(r, signReceipt(escrow, attestorKey, r));
        assertEq(usdg.balanceOf(payee), 10_000);
        assertEq(usdg.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getLock(id).status), uint8(LoxleyEscrow.Status.Released));
    }

    function test_releaseTakesFee() public {
        bytes32 id = keccak256("req-fee");
        _open(feeEscrow, id, 10_000, uint64(block.timestamp + 10 minutes), 3);
        LoxleyEscrow.Receipt memory r =
            LoxleyEscrow.Receipt({requestId: id, responseHash: keccak256("body"), status: 200, accepted: true});
        feeEscrow.release(r, signReceipt(feeEscrow, attestorKey, r));
        assertEq(usdg.balanceOf(payee), 9_900);
        assertEq(usdg.balanceOf(feeRecipient), 100);
    }

    function test_refundReturnsToPayer() public {
        bytes32 id = keccak256("req-3");
        _open(escrow, id, 10_000, uint64(block.timestamp + 10 minutes), 4);
        LoxleyEscrow.Receipt memory r =
            LoxleyEscrow.Receipt({requestId: id, responseHash: bytes32(0), status: 503, accepted: false});
        escrow.refund(r, signReceipt(escrow, attestorKey, r));
        assertEq(usdg.balanceOf(payer), 1_000e6);
        assertEq(uint8(escrow.getLock(id).status), uint8(LoxleyEscrow.Status.Refunded));
    }

    function test_reclaimAfterDeadline() public {
        bytes32 id = keccak256("req-4");
        uint64 deadline = uint64(block.timestamp + 10 minutes);
        _open(escrow, id, 10_000, deadline, 5);
        vm.expectRevert(abi.encodeWithSelector(LoxleyEscrow.NotExpired.selector, id));
        escrow.reclaim(id);
        vm.warp(deadline + 1);
        escrow.reclaim(id);
        assertEq(usdg.balanceOf(payer), 1_000e6);
        assertEq(uint8(escrow.getLock(id).status), uint8(LoxleyEscrow.Status.Reclaimed));
    }

    function test_verdictMustMatchFunction() public {
        bytes32 id = keccak256("req-5");
        _open(escrow, id, 10_000, uint64(block.timestamp + 10 minutes), 6);
        LoxleyEscrow.Receipt memory ok =
            LoxleyEscrow.Receipt({requestId: id, responseHash: keccak256("body"), status: 200, accepted: true});
        bytes memory sig = signReceipt(escrow, attestorKey, ok);
        vm.expectRevert(LoxleyEscrow.ReceiptVerdictMismatch.selector);
        escrow.refund(ok, sig);
    }

    function test_rejectsForgedReceipt() public {
        bytes32 id = keccak256("req-6");
        _open(escrow, id, 10_000, uint64(block.timestamp + 10 minutes), 7);
        LoxleyEscrow.Receipt memory r =
            LoxleyEscrow.Receipt({requestId: id, responseHash: keccak256("body"), status: 200, accepted: true});
        bytes memory forged = signReceipt(escrow, 0xBAD, r);
        vm.expectRevert(LoxleyEscrow.BadReceipt.selector);
        escrow.release(r, forged);
    }

    function test_receiptCannotBeReplayed() public {
        bytes32 id = keccak256("req-7");
        _open(escrow, id, 10_000, uint64(block.timestamp + 10 minutes), 8);
        LoxleyEscrow.Receipt memory r =
            LoxleyEscrow.Receipt({requestId: id, responseHash: keccak256("body"), status: 200, accepted: true});
        bytes memory sig = signReceipt(escrow, attestorKey, r);
        escrow.release(r, sig);
        vm.expectRevert(abi.encodeWithSelector(LoxleyEscrow.NotOpen.selector, id));
        escrow.release(r, sig);
    }

    function test_duplicateRequestIdRejected() public {
        bytes32 id = keccak256("req-8");
        _open(escrow, id, 10_000, uint64(block.timestamp + 10 minutes), 9);
        LoxleyEscrow.EscrowWitness memory w = LoxleyEscrow.EscrowWitness({
            requestId: id, payee: payee, attestor: attestor, deadline: uint64(block.timestamp + 10 minutes), schemaHash: 0
        });
        ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: address(usdg), amount: 1}),
            nonce: 10,
            deadline: block.timestamp + 1 hours
        });
        bytes memory sig =
            signPermit(permit2, payerKey, permit, address(escrow), witnessHashFor(escrow, w), escrow.WITNESS_TYPE_STRING());
        vm.expectRevert(abi.encodeWithSelector(LoxleyEscrow.RequestExists.selector, id));
        escrow.open(permit, payer, w, sig);
    }

    function test_tamperedWitnessFailsSignature() public {
        bytes32 id = keccak256("req-9");
        LoxleyEscrow.EscrowWitness memory w = LoxleyEscrow.EscrowWitness({
            requestId: id, payee: payee, attestor: attestor, deadline: uint64(block.timestamp + 10 minutes), schemaHash: 0
        });
        ISignatureTransfer.PermitTransferFrom memory permit = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: address(usdg), amount: 10_000}),
            nonce: 11,
            deadline: block.timestamp + 1 hours
        });
        bytes memory sig =
            signPermit(permit2, payerKey, permit, address(escrow), witnessHashFor(escrow, w), escrow.WITNESS_TYPE_STRING());
        // Facilitator tries to redirect the payment to itself.
        w.payee = facilitator;
        vm.expectRevert();
        escrow.open(permit, payer, w, sig);
    }

    function test_constructorRejectsBadFee() public {
        vm.expectRevert(LoxleyEscrow.InvalidFee.selector);
        new LoxleyEscrow(address(permit2), 501, feeRecipient);
        vm.expectRevert(LoxleyEscrow.InvalidFee.selector);
        new LoxleyEscrow(address(permit2), 1, address(0));
    }

    function testFuzz_releaseConservesValue(uint96 amount, uint16 feeBps) public {
        amount = uint96(bound(amount, 1, 1_000e6));
        feeBps = uint16(bound(feeBps, 0, 500));
        LoxleyEscrow e = new LoxleyEscrow(address(permit2), feeBps, feeRecipient);
        bytes32 id = keccak256(abi.encode(amount, feeBps));
        _open(e, id, amount, uint64(block.timestamp + 10 minutes), uint256(id));
        LoxleyEscrow.Receipt memory r =
            LoxleyEscrow.Receipt({requestId: id, responseHash: keccak256("body"), status: 200, accepted: true});
        e.release(r, signReceipt(e, attestorKey, r));
        assertEq(usdg.balanceOf(payee) + usdg.balanceOf(feeRecipient) + usdg.balanceOf(payer), 1_000e6);
        assertEq(usdg.balanceOf(feeRecipient), (uint256(amount) * feeBps) / 10_000);
    }
}

contract MockUSDGTest is Permit2Helper {
    function test_dripRateLimited() public {
        MockUSDG t = new MockUSDG(address(this));
        address a = makeAddr("a");
        vm.prank(a);
        t.drip();
        assertEq(t.balanceOf(a), 1_000e6);
        vm.prank(a);
        vm.expectRevert();
        t.drip();
        vm.warp(block.timestamp + 24 hours);
        vm.prank(a);
        t.drip();
        assertEq(t.balanceOf(a), 2_000e6);
        assertEq(t.decimals(), 6);
    }
}
