// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISignatureTransfer} from "permit2/interfaces/ISignatureTransfer.sol";
import {LoxleyEscrow} from "../src/LoxleyEscrow.sol";

/// @dev Signs Permit2 PermitWitnessTransferFrom messages for LoxleyEscrow the way a client SDK would.
abstract contract Permit2Helper is Test {
    bytes32 internal constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");

    function permitWitnessTypehash(string memory witnessTypeString) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,",
                witnessTypeString
            )
        );
    }

    function signPermit(
        ISignatureTransfer permit2,
        uint256 payerKey,
        ISignatureTransfer.PermitTransferFrom memory permit,
        address spender,
        bytes32 witnessHash,
        string memory witnessTypeString
    ) internal view returns (bytes memory) {
        bytes32 tokenPermissions = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permit.permitted));
        bytes32 structHash = keccak256(
            abi.encode(
                permitWitnessTypehash(witnessTypeString), tokenPermissions, spender, permit.nonce, permit.deadline, witnessHash
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", permit2.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function witnessHashFor(LoxleyEscrow escrow, LoxleyEscrow.EscrowWitness memory w) internal view returns (bytes32) {
        return keccak256(abi.encode(escrow.WITNESS_TYPEHASH(), w.requestId, w.payee, w.attestor, w.deadline, w.schemaHash));
    }

    function signReceipt(LoxleyEscrow escrow, uint256 attestorKey, LoxleyEscrow.Receipt memory r)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(attestorKey, escrow.receiptDigest(r));
        return abi.encodePacked(rr, ss, v);
    }
}
