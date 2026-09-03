// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";

/**
 * Deploys the ERC-8004 reference registries (ChaosChain trustless-agents-erc-ri, MIT) to Robinhood Chain
 * through Arachnid's CREATE2 deployer, using the bytecode compiled in lib/erc-8004 with its own toolchain
 * (solc 0.8.19, via-ir). Addresses are identical on 4663 and 46630 and independent of the deployer key.
 *
 *   (cd lib/erc-8004 && forge build)
 *   forge script script/DeployAgentRegistries.s.sol --rpc-url $RHC_TESTNET_RPC_URL --broadcast
 */
contract DeployAgentRegistries is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 constant SALT = keccak256("loxley.erc8004.v1");

    function run() external returns (address identity, address reputation, address validation) {
        require(CREATE2_DEPLOYER.code.length > 0, "CREATE2 deployer missing on this chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        bytes memory identityInit = _creationCode("IdentityRegistry");
        identity = _deploy("IdentityRegistry", identityInit, pk);

        bytes memory reputationInit = abi.encodePacked(_creationCode("ReputationRegistry"), abi.encode(identity));
        reputation = _deploy("ReputationRegistry", reputationInit, pk);

        bytes memory validationInit = abi.encodePacked(_creationCode("ValidationRegistry"), abi.encode(identity));
        validation = _deploy("ValidationRegistry", validationInit, pk);

        console2.log("chainId", block.chainid);
        console2.log("IdentityRegistry  ", identity);
        console2.log("ReputationRegistry", reputation);
        console2.log("ValidationRegistry", validation);
    }

    function _creationCode(string memory name) internal view returns (bytes memory) {
        string memory json = vm.readFile(string.concat("lib/erc-8004/out/", name, ".sol/", name, ".json"));
        return vm.parseJsonBytes(json, ".bytecode.object");
    }

    function _deploy(string memory name, bytes memory initCode, uint256 pk) internal returns (address expected) {
        expected = vm.computeCreate2Address(SALT, keccak256(initCode), CREATE2_DEPLOYER);
        if (expected.code.length > 0) {
            console2.log(string.concat(name, " already deployed"), expected);
            return expected;
        }
        vm.startBroadcast(pk);
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(SALT, initCode));
        vm.stopBroadcast();
        require(ok && expected.code.length > 0, string.concat("CREATE2 deploy failed: ", name));
    }
}
