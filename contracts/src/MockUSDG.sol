// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDG
 * @notice Testnet stand-in for USDG on Robinhood Chain Testnet (46630). Same name, symbol and
 *         6 decimals as mainnet USDG, and like mainnet USDG it has no EIP-3009 and no EIP-2612,
 *         so anything that works against this token works against the real one.
 *
 *         Built-in faucet: `drip()` mints DRIP_AMOUNT to the caller once per DRIP_INTERVAL.
 */
contract MockUSDG is ERC20, Ownable {
    uint256 public constant DRIP_AMOUNT = 1_000e6;
    uint256 public constant DRIP_INTERVAL = 24 hours;

    mapping(address => uint256) public lastDrip;

    event Dripped(address indexed to, uint256 amount);

    error DripTooSoon(uint256 nextAt);

    constructor(address owner_) ERC20("Global Dollar", "USDG") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function drip() external {
        uint256 last = lastDrip[msg.sender];
        if (last != 0 && block.timestamp < last + DRIP_INTERVAL) revert DripTooSoon(last + DRIP_INTERVAL);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, DRIP_AMOUNT);
        emit Dripped(msg.sender, DRIP_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
