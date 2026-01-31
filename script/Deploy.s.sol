// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/AgentDirectory.sol";

contract DeployAgentDirectory is Script {
    function run() external {
        // Registration fee: 0.001 ETH (~$2-3)
        uint256 registrationFee = 0.001 ether;
        
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);
        
        AgentDirectory directory = new AgentDirectory(registrationFee);
        
        console.log("AgentDirectory deployed to:", address(directory));
        console.log("Registration fee:", registrationFee);
        console.log("Owner:", directory.owner());
        
        vm.stopBroadcast();
    }
}
