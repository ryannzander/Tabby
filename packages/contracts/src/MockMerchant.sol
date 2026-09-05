// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Receives payment for a shop invoice and records it on-chain, so "buy" is verifiable.
contract MockMerchant {
    mapping(bytes32 invoiceId => uint256 paidWei) public paid;

    event InvoicePaid(bytes32 indexed invoiceId, address indexed payer, uint256 value);

    function pay(bytes32 invoiceId) external payable {
        paid[invoiceId] += msg.value;
        emit InvoicePaid(invoiceId, msg.sender, msg.value);
    }
}
