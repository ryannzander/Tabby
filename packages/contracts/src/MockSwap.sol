// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockToken} from "./MockToken.sol";

/// @notice A fixed-rate "DEX" that exists only so the swap action is a genuine contract call.
contract MockSwap {
    MockToken public immutable token;
    /// @notice Tokens minted per 1 native coin.
    uint256 public constant RATE = 1000;

    event Swapped(address indexed buyer, uint256 valueIn, uint256 tokensOut);

    error Slippage(uint256 got, uint256 minOut);

    constructor(MockToken _token) {
        token = _token;
    }

    function quote(uint256 valueIn) public pure returns (uint256) {
        return valueIn * RATE;
    }

    function swapExactEthForTokens(uint256 minOut) external payable returns (uint256 out) {
        out = quote(msg.value);
        if (out < minOut) revert Slippage(out, minOut);
        token.mint(msg.sender, out);
        emit Swapped(msg.sender, msg.value, out);
    }
}
