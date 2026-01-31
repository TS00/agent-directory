// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/AgentDirectory.sol";

contract AgentDirectoryTest is Test {
    AgentDirectory public directory;
    
    address public owner = address(0x1111111111111111111111111111111111111111);
    address public user1 = address(0x2222222222222222222222222222222222222222);
    address public user2 = address(0x3333333333333333333333333333333333333333);
    
    uint256 public constant FEE = 0.001 ether;
    
    function setUp() public {
        vm.prank(owner);
        directory = new AgentDirectory(FEE);
    }
    
    // ============ Registration Tests ============
    
    function test_Register() public {
        string[] memory platforms = new string[](2);
        platforms[0] = "moltbook";
        platforms[1] = "discord";
        
        string[] memory urls = new string[](2);
        urls[0] = "https://moltbook.com/u/TestAgent";
        urls[1] = "https://discord.com/users/123";
        
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        directory.register{value: FEE}("TestAgent", platforms, urls);
        
        assertTrue(directory.isRegistered("TestAgent"));
        assertEq(directory.count(), 1);
        
        (
            string memory name,
            string[] memory retPlatforms,
            string[] memory retUrls,
            address registrant,
            ,
            
        ) = directory.lookup("TestAgent");
        
        assertEq(name, "TestAgent");
        assertEq(retPlatforms.length, 2);
        assertEq(retPlatforms[0], "moltbook");
        assertEq(retUrls[0], "https://moltbook.com/u/TestAgent");
        assertEq(registrant, user1);
    }
    
    function test_RegisterFailsWithInsufficientFee() public {
        string[] memory platforms = new string[](1);
        platforms[0] = "moltbook";
        string[] memory urls = new string[](1);
        urls[0] = "https://moltbook.com/u/Test";
        
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        vm.expectRevert("Insufficient fee");
        directory.register{value: FEE - 1}("Test", platforms, urls);
    }
    
    function test_RegisterFailsWithDuplicateName() public {
        string[] memory platforms = new string[](1);
        platforms[0] = "moltbook";
        string[] memory urls = new string[](1);
        urls[0] = "https://moltbook.com/u/Test";
        
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        directory.register{value: FEE}("Test", platforms, urls);
        
        vm.deal(user2, 1 ether);
        vm.prank(user2);
        vm.expectRevert("Name taken");
        directory.register{value: FEE}("Test", platforms, urls);
    }
    
    function test_RegisterRefundsExcess() public {
        string[] memory platforms = new string[](1);
        platforms[0] = "moltbook";
        string[] memory urls = new string[](1);
        urls[0] = "https://moltbook.com/u/Test";
        
        vm.deal(user1, 1 ether);
        uint256 balanceBefore = user1.balance;
        
        vm.prank(user1);
        directory.register{value: 0.01 ether}("Test", platforms, urls);
        
        // Should have been refunded the excess (0.01 - 0.001 = 0.009)
        assertEq(user1.balance, balanceBefore - FEE);
    }
    
    // ============ Update Tests ============
    
    function test_Update() public {
        string[] memory platforms = new string[](1);
        platforms[0] = "moltbook";
        string[] memory urls = new string[](1);
        urls[0] = "https://moltbook.com/u/Test";
        
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        directory.register{value: FEE}("Test", platforms, urls);
        
        // Update with new platform
        string[] memory newPlatforms = new string[](2);
        newPlatforms[0] = "moltbook";
        newPlatforms[1] = "twitter";
        string[] memory newUrls = new string[](2);
        newUrls[0] = "https://moltbook.com/u/Test";
        newUrls[1] = "https://twitter.com/test";
        
        vm.prank(user1);
        directory.update("Test", newPlatforms, newUrls);
        
        (, string[] memory retPlatforms, , , ,) = directory.lookup("Test");
        assertEq(retPlatforms.length, 2);
        assertEq(retPlatforms[1], "twitter");
    }
    
    function test_UpdateFailsForNonRegistrant() public {
        string[] memory platforms = new string[](1);
        platforms[0] = "moltbook";
        string[] memory urls = new string[](1);
        urls[0] = "https://moltbook.com/u/Test";
        
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        directory.register{value: FEE}("Test", platforms, urls);
        
        vm.prank(user2);
        vm.expectRevert("Not registrant");
        directory.update("Test", platforms, urls);
    }
    
    // ============ Heartbeat Tests ============
    
    function test_Heartbeat() public {
        string[] memory platforms = new string[](1);
        platforms[0] = "moltbook";
        string[] memory urls = new string[](1);
        urls[0] = "https://moltbook.com/u/Test";
        
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        directory.register{value: FEE}("Test", platforms, urls);
        
        // Advance time
        vm.warp(block.timestamp + 1 days);
        
        vm.prank(user1);
        directory.heartbeat("Test");
        
        (, , , , , uint256 lastSeen) = directory.lookup("Test");
        assertEq(lastSeen, block.timestamp);
    }
    
    // ============ Admin Tests ============
    
    function test_Withdraw() public {
        string[] memory platforms = new string[](1);
        platforms[0] = "moltbook";
        string[] memory urls = new string[](1);
        urls[0] = "https://moltbook.com/u/Test";
        
        vm.deal(user1, 1 ether);
        vm.prank(user1);
        directory.register{value: FEE}("Test", platforms, urls);
        
        // Give owner some initial balance so they can receive
        vm.deal(owner, 1 ether);
        uint256 ownerBalanceBefore = owner.balance;
        
        vm.prank(owner);
        directory.withdraw();
        
        assertEq(owner.balance, ownerBalanceBefore + FEE);
        assertEq(address(directory).balance, 0);
    }
    
    function test_SetRegistrationFee() public {
        vm.prank(owner);
        directory.setRegistrationFee(0.002 ether);
        
        assertEq(directory.registrationFee(), 0.002 ether);
    }
    
    // ============ Enumeration Tests ============
    
    function test_GetAgentNames() public {
        string[] memory platforms = new string[](1);
        platforms[0] = "moltbook";
        string[] memory urls = new string[](1);
        urls[0] = "https://moltbook.com/u/Test";
        
        vm.deal(user1, 1 ether);
        
        vm.prank(user1);
        directory.register{value: FEE}("Agent1", platforms, urls);
        
        vm.prank(user1);
        directory.register{value: FEE}("Agent2", platforms, urls);
        
        vm.prank(user1);
        directory.register{value: FEE}("Agent3", platforms, urls);
        
        string[] memory names = directory.getAgentNames(0, 10);
        assertEq(names.length, 3);
        assertEq(names[0], "Agent1");
        assertEq(names[1], "Agent2");
        assertEq(names[2], "Agent3");
        
        // Test pagination
        string[] memory page2 = directory.getAgentNames(1, 2);
        assertEq(page2.length, 2);
        assertEq(page2[0], "Agent2");
    }
}
