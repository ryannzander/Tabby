// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FlippyGate} from "../src/FlippyGate.sol";
import {MockToken} from "../src/MockToken.sol";
import {MockSwap} from "../src/MockSwap.sol";
import {MockMerchant} from "../src/MockMerchant.sol";

/// @notice Deploys the whole demo world and writes addresses to deployments/<chain>.json.
/// @dev Required env: DEPLOYER_KEY, AGENT_ADDRESS, HUMAN_ADDRESS, CHAIN_KEY.
///      Optional: GATE_FUNDING_WEI (default 0.05e18).
///      Re-run freely; addresses in git are the source of truth for the apps.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address human = vm.envAddress("HUMAN_ADDRESS");
        string memory chainKey = vm.envString("CHAIN_KEY");
        uint256 funding = vm.envOr("GATE_FUNDING_WEI", uint256(0.05 ether));

        vm.startBroadcast(deployerKey);

        FlippyGate gate = new FlippyGate(agent, human);
        MockToken token = new MockToken();
        MockSwap swap = new MockSwap(token);
        MockMerchant merchant = new MockMerchant();

        if (funding > 0) {
            (bool ok,) = address(gate).call{value: funding}("");
            require(ok, "funding the gate failed");
        }

        vm.stopBroadcast();

        console2.log("gate     ", address(gate));
        console2.log("token    ", address(token));
        console2.log("swap     ", address(swap));
        console2.log("merchant ", address(merchant));

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "gate", address(gate));
        vm.serializeAddress(obj, "token", address(token));
        vm.serializeAddress(obj, "swap", address(swap));
        vm.serializeAddress(obj, "merchant", address(merchant));
        vm.serializeAddress(obj, "agent", agent);
        string memory json = vm.serializeAddress(obj, "human", human);
        vm.writeJson(json, string.concat("./deployments/", chainKey, ".json"));
    }
}
