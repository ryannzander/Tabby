// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title TappyGate — a 2-of-2 wallet: an AI agent proposes, a human physically approves.
/// @notice Neither key can move funds alone. `execute` requires a signature from BOTH the
///         agent key and the human key over the same EIP-712 digest. Anyone may relay the
///         call; the signatures, not msg.sender, are the authority.
/// @dev Deliberately has no spending limits, allowlists or owner rotation. Those are policy
///      features other products already ship; the point of this contract is the second hand.
contract TappyGate is EIP712 {
    bytes32 private constant EXECUTE_TYPEHASH =
        keccak256("Execute(uint256 nonce,address to,uint256 value,bytes data,uint256 deadline)");

    address public immutable agent;
    address public immutable human;

    /// @notice Monotonic; every executed call consumes exactly one nonce. Prevents replay.
    uint256 public nonce;

    event Executed(uint256 indexed usedNonce, address indexed to, uint256 value, bytes32 digest);

    error Expired();
    error BadAgentSig();
    error BadHumanSig();
    error CallFailed(bytes ret);
    error ZeroAddress();

    constructor(address _agent, address _human) EIP712("TappyGate", "1") {
        if (_agent == address(0) || _human == address(0)) revert ZeroAddress();
        agent = _agent;
        human = _human;
    }

    receive() external payable {}

    /// @notice The digest both parties sign. Exposed so off-chain code can assert it matches.
    function digestOf(uint256 n, address to, uint256 value, bytes calldata data, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(EXECUTE_TYPEHASH, n, to, value, keccak256(data), deadline))
        );
    }

    /// @notice Execute a call once both keys have signed it.
    /// @dev The nonce is consumed before the external call, and the whole transaction reverts
    ///      if the call fails — so a failed action leaves the nonce untouched and the same
    ///      signatures can be retried after the cause is fixed.
    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        uint256 deadline,
        bytes calldata agentSig,
        bytes calldata humanSig
    ) external returns (bytes memory) {
        if (block.timestamp > deadline) revert Expired();

        uint256 n = nonce;
        bytes32 digest = digestOf(n, to, value, data, deadline);

        if (ECDSA.recover(digest, agentSig) != agent) revert BadAgentSig();
        if (ECDSA.recover(digest, humanSig) != human) revert BadHumanSig();

        nonce = n + 1;

        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) revert CallFailed(ret);

        emit Executed(n, to, value, digest);
        return ret;
    }
}
