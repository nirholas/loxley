// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {LoxleyEscrow} from "../src/LoxleyEscrow.sol";

/**
 * Deterministic deployment through Arachnid's CREATE2 deployer so LoxleyEscrow lands at the same
 * address on Robinhood Chain mainnet (4663) and testnet (46630).
 *
 *   forge script script/DeployEscrow.s.sol --rpc-url $RHC_TESTNET_RPC_URL --broadcast
 */
contract DeployEscrow is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 constant SALT = keccak256("loxley.escrow.v1");

    function run() external returns (address deployed) {
        uint256 feeBps = vm.envOr("ESCROW_FEE_BPS", uint256(0));
        address feeRecipient = vm.envOr("ESCROW_FEE_RECIPIENT", address(0));
        bytes memory initCode = abi.encodePacked(type(LoxleyEscrow).creationCode, abi.encode(PERMIT2, feeBps, feeRecipient));
        address expected = vm.computeCreate2Address(SALT, keccak256(initCode), CREATE2_DEPLOYER);
        console2.log("chainId", block.chainid);
        console2.log("expected LoxleyEscrow", expected);

        require(PERMIT2.code.length > 0, "Permit2 missing on this chain");
        require(CREATE2_DEPLOYER.code.length > 0, "CREATE2 deployer missing on this chain");
        if (expected.code.length > 0) {
            console2.log("already deployed");
            return expected;
        }

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(SALT, initCode));
        vm.stopBroadcast();
        require(ok && expected.code.length > 0, "CREATE2 deploy failed");
        require(address(LoxleyEscrow(expected).PERMIT2()) == PERMIT2, "PERMIT2 mismatch");
        console2.log("deployed LoxleyEscrow", expected);
        return expected;
    }
}
