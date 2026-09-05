// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet-only token so `swap` is a real on-chain call. Mint is intentionally open.
contract MockToken is ERC20 {
    constructor() ERC20("Tappy Test Token", "FLIP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
