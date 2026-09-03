// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDG} from "../src/MockUSDG.sol";

/// Testnet only. Refuses to run on Robinhood Chain mainnet.
contract DeployMockUSDG is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 constant SALT = keccak256("loxley.mock-usdg.v1");

    function run() external returns (address deployed) {
        require(block.chainid != 4663, "MockUSDG must never be deployed to mainnet");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        bytes memory initCode = abi.encodePacked(type(MockUSDG).creationCode, abi.encode(owner));
        address expected = vm.computeCreate2Address(SALT, keccak256(initCode), CREATE2_DEPLOYER);
        console2.log("expected MockUSDG", expected);
        if (expected.code.length > 0) {
            console2.log("already deployed");
            return expected;
        }
        vm.startBroadcast(pk);
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(SALT, initCode));
        vm.stopBroadcast();
        require(ok && expected.code.length > 0, "CREATE2 deploy failed");
        console2.log("deployed MockUSDG", expected);
        return expected;
    }
}
