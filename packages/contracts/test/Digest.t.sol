// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {TappyGate} from "../src/TappyGate.sol";

/// @notice Guards Risk #3: if Solidity and TypeScript disagree by one byte, every execute()
///         reverts with a useless "bad sig". Both sides assert the same frozen vector.
contract DigestTest is Test {
    string constant VECTOR = "../protocol/vectors/execute.json";

    function test_matches_the_shared_typescript_vector() public {
        string memory json = vm.readFile(VECTOR);

        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        address gateAddr = vm.parseJsonAddress(json, ".gate");
        uint256 nonce = vm.parseJsonUint(json, ".nonce");
        address to = vm.parseJsonAddress(json, ".to");
        uint256 value = vm.parseJsonUint(json, ".value");
        bytes memory data = vm.parseJsonBytes(json, ".data");
        uint256 deadline = vm.parseJsonUint(json, ".deadline");
        bytes32 expectedDigest = vm.parseJsonBytes32(json, ".digest");

        address agent = vm.parseJsonAddress(json, ".agentAddress");
        address human = vm.parseJsonAddress(json, ".humanAddress");
        bytes memory agentSig = vm.parseJsonBytes(json, ".agentSig");
        bytes memory humanSig = vm.parseJsonBytes(json, ".humanSig");

        // The vector pins a specific chainId and contract address, so deploy to that address there.
        vm.chainId(chainId);
        TappyGate gate = new TappyGate(agent, human);
        vm.etch(gateAddr, address(gate).code);
        TappyGate pinned = TappyGate(payable(gateAddr));

        bytes32 got = pinned.digestOf(nonce, to, value, data, deadline);
        assertEq(got, expectedDigest, "Solidity digest != TypeScript digest");

        assertEq(ECDSA.recover(expectedDigest, agentSig), agent, "agent signature vector");
        assertEq(ECDSA.recover(expectedDigest, humanSig), human, "human signature vector");
    }
}
