// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";

/// Prints the storage slot that holds balanceOf(HOLDER) for USDG on the connected fork.
/// Used by the anvil-based e2e harness to fund test payers with anvil_setStorageAt.
contract FindUsdgSlot is Script {
    using stdStorage for StdStorage;

    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    function run() external {
        address holder = vm.envOr("HOLDER", address(0x1111111111111111111111111111111111111111));
        uint256 slot = stdstore.target(USDG).sig("balanceOf(address)").with_key(holder).find();
        console2.log("holder", holder);
        console2.log("slot", slot);
        console2.logBytes32(bytes32(slot));
    }
}
