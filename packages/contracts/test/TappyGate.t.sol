// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TappyGate} from "../src/TappyGate.sol";
import {MockToken} from "../src/MockToken.sol";
import {MockSwap} from "../src/MockSwap.sol";
import {MockMerchant} from "../src/MockMerchant.sol";

contract Reverter {
    error Nope();

    fallback() external payable {
        revert Nope();
    }
}

contract TappyGateTest is Test {
    TappyGate gate;
    MockToken token;
    MockSwap swap;
    MockMerchant merchant;

    uint256 agentKey = 0xA11CE;
    uint256 humanKey = 0xB0B;
    uint256 strangerKey = 0xBAD;
    address agent;
    address human;
    address payable recipient = payable(address(0xD00D));

    function setUp() public {
        agent = vm.addr(agentKey);
        human = vm.addr(humanKey);
        gate = new TappyGate(agent, human);
        token = new MockToken();
        swap = new MockSwap(token);
        merchant = new MockMerchant();
        vm.deal(address(gate), 10 ether);
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _digest(address to, uint256 value, bytes memory data, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        return gate.digestOf(gate.nonce(), to, value, data, deadline);
    }

    function test_executes_when_both_keys_sign() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory data = "";
        bytes32 d = _digest(recipient, 1 ether, data, deadline);

        gate.execute(recipient, 1 ether, data, deadline, _sign(agentKey, d), _sign(humanKey, d));

        assertEq(recipient.balance, 1 ether);
        assertEq(gate.nonce(), 1, "nonce consumed");
    }

    function test_executes_a_contract_call() public {
        uint256 deadline = block.timestamp + 600;
        bytes memory data = abi.encodeCall(MockSwap.swapExactEthForTokens, (1000 ether));
        bytes32 d = _digest(address(swap), 1 ether, data, deadline);

        gate.execute(address(swap), 1 ether, data, deadline, _sign(agentKey, d), _sign(humanKey, d));

        assertEq(token.balanceOf(address(gate)), 1000 ether);
    }

    function test_pays_a_merchant_invoice() public {
        uint256 deadline = block.timestamp + 600;
        bytes32 invoice = keccak256("inv-001");
        bytes memory data = abi.encodeCall(MockMerchant.pay, (invoice));
        bytes32 d = _digest(address(merchant), 0.01 ether, data, deadline);

        gate.execute(address(merchant), 0.01 ether, data, deadline, _sign(agentKey, d), _sign(humanKey, d));

        assertEq(merchant.paid(invoice), 0.01 ether);
    }

    function test_reverts_when_agent_signature_is_wrong() public {
        uint256 deadline = block.timestamp + 600;
        bytes32 d = _digest(recipient, 1 ether, "", deadline);
        vm.expectRevert(TappyGate.BadAgentSig.selector);
        gate.execute(recipient, 1 ether, "", deadline, _sign(strangerKey, d), _sign(humanKey, d));
    }

    function test_reverts_when_human_signature_is_wrong() public {
        uint256 deadline = block.timestamp + 600;
        bytes32 d = _digest(recipient, 1 ether, "", deadline);
        vm.expectRevert(TappyGate.BadHumanSig.selector);
        gate.execute(recipient, 1 ether, "", deadline, _sign(agentKey, d), _sign(strangerKey, d));
    }

    /// @dev The agent key alone must be useless. This is the whole product.
    function test_agent_alone_cannot_move_funds() public {
        uint256 deadline = block.timestamp + 600;
        bytes32 d = _digest(recipient, 1 ether, "", deadline);
        bytes memory agentSig = _sign(agentKey, d);
        vm.expectRevert(TappyGate.BadHumanSig.selector);
        gate.execute(recipient, 1 ether, "", deadline, agentSig, agentSig);
        assertEq(recipient.balance, 0);
    }

    function test_reverts_when_signatures_are_swapped() public {
        uint256 deadline = block.timestamp + 600;
        bytes32 d = _digest(recipient, 1 ether, "", deadline);
        vm.expectRevert(TappyGate.BadAgentSig.selector);
        gate.execute(recipient, 1 ether, "", deadline, _sign(humanKey, d), _sign(agentKey, d));
    }

    function test_reverts_on_replay() public {
        uint256 deadline = block.timestamp + 600;
        bytes32 d = _digest(recipient, 1 ether, "", deadline);
        bytes memory a = _sign(agentKey, d);
        bytes memory h = _sign(humanKey, d);

        gate.execute(recipient, 1 ether, "", deadline, a, h);
        vm.expectRevert(TappyGate.BadAgentSig.selector); // nonce moved, so the digest no longer matches
        gate.execute(recipient, 1 ether, "", deadline, a, h);
    }

    function test_reverts_after_deadline() public {
        uint256 deadline = block.timestamp + 600;
        bytes32 d = _digest(recipient, 1 ether, "", deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(TappyGate.Expired.selector);
        gate.execute(recipient, 1 ether, "", deadline, _sign(agentKey, d), _sign(humanKey, d));
    }

    function test_failed_inner_call_reverts_everything_including_the_nonce() public {
        Reverter r = new Reverter();
        uint256 deadline = block.timestamp + 600;
        bytes memory data = hex"1234";
        bytes32 d = _digest(address(r), 0, data, deadline);

        vm.expectRevert();
        gate.execute(address(r), 0, data, deadline, _sign(agentKey, d), _sign(humanKey, d));
        assertEq(gate.nonce(), 0, "nonce must not be consumed by a failed call");
    }

    function test_anyone_may_relay() public {
        uint256 deadline = block.timestamp + 600;
        bytes32 d = _digest(recipient, 1 ether, "", deadline);
        vm.prank(address(0xFEE));
        gate.execute(recipient, 1 ether, "", deadline, _sign(agentKey, d), _sign(humanKey, d));
        assertEq(recipient.balance, 1 ether);
    }

    function test_constructor_rejects_zero_addresses() public {
        vm.expectRevert(TappyGate.ZeroAddress.selector);
        new TappyGate(address(0), human);
        vm.expectRevert(TappyGate.ZeroAddress.selector);
        new TappyGate(agent, address(0));
    }
}
