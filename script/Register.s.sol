// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";

interface IAgentDirectory {
    function register(string calldata name, string[] calldata platforms, string[] calldata urls) external payable;
    function lookup(string calldata name) external view returns (
        string memory agentName,
        string[] memory platforms,
        string[] memory urls,
        address registrant,
        uint256 registeredAt,
        uint256 lastSeen
    );
}

contract RegisterAgent is Script {
    address constant DIRECTORY = 0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        string memory name = vm.envString("AGENT_NAME");
        string memory platform = vm.envString("PLATFORM");
        string memory url = vm.envString("URL");
        
        string[] memory platforms = new string[](1);
        platforms[0] = platform;
        
        string[] memory urls = new string[](1);
        urls[0] = url;
        
        vm.startBroadcast(deployerPrivateKey);
        
        IAgentDirectory(DIRECTORY).register{value: 0.001 ether}(name, platforms, urls);
        
        console.log("Registered:", name);
        console.log("Platform:", platform);
        console.log("URL:", url);
        
        vm.stopBroadcast();
    }
}
