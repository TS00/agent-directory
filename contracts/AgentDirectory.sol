// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentDirectory
 * @notice Decentralized registry for AI agents across platforms
 * @dev Deployed on Base L2 for low-cost registrations
 */
contract AgentDirectory {
    
    // ============ Structs ============
    
    struct Agent {
        string name;
        address registrant;
        uint256 registeredAt;
        uint256 lastSeen;
        uint256 platformCount;
    }
    
    // ============ State ============
    
    // Core agent data
    mapping(string => Agent) private agents;
    
    // Platform data stored separately to avoid nested array issues
    // agentName => index => platform
    mapping(string => mapping(uint256 => string)) private agentPlatforms;
    // agentName => index => url
    mapping(string => mapping(uint256 => string)) private agentUrls;
    
    string[] public agentNames;
    mapping(string => bool) public nameExists;
    
    address public owner;
    uint256 public registrationFee;
    uint256 public totalRegistrations;
    
    // ============ Events ============
    
    event AgentRegistered(
        string indexed nameHash,
        string name,
        address registrant,
        uint256 timestamp
    );
    
    event AgentUpdated(
        string indexed nameHash,
        string name,
        uint256 timestamp
    );
    
    event Heartbeat(
        string indexed nameHash,
        string name,
        uint256 timestamp
    );
    
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event Withdrawal(address to, uint256 amount);
    
    // ============ Modifiers ============
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    modifier onlyRegistrant(string calldata name) {
        require(agents[name].registrant == msg.sender, "Not registrant");
        _;
    }
    
    // ============ Constructor ============
    
    constructor(uint256 _registrationFee) {
        owner = msg.sender;
        registrationFee = _registrationFee;
    }
    
    // ============ Registration ============
    
    /**
     * @notice Register a new agent in the directory
     * @param name Unique agent name
     * @param platforms Array of platform names
     * @param urls Array of profile URLs (must match platforms length)
     */
    function register(
        string calldata name,
        string[] calldata platforms,
        string[] calldata urls
    ) external payable {
        require(bytes(name).length > 0, "Name required");
        require(bytes(name).length <= 64, "Name too long");
        require(!nameExists[name], "Name taken");
        require(platforms.length > 0, "At least one platform required");
        require(platforms.length == urls.length, "Platforms/URLs mismatch");
        require(platforms.length <= 20, "Too many platforms");
        require(msg.value >= registrationFee, "Insufficient fee");
        
        // Store agent core data
        agents[name] = Agent({
            name: name,
            registrant: msg.sender,
            registeredAt: block.timestamp,
            lastSeen: block.timestamp,
            platformCount: platforms.length
        });
        
        // Store platforms and URLs separately
        for (uint256 i = 0; i < platforms.length; i++) {
            agentPlatforms[name][i] = platforms[i];
            agentUrls[name][i] = urls[i];
        }
        
        agentNames.push(name);
        nameExists[name] = true;
        totalRegistrations++;
        
        emit AgentRegistered(name, name, msg.sender, block.timestamp);
        
        // Refund excess payment
        if (msg.value > registrationFee) {
            payable(msg.sender).transfer(msg.value - registrationFee);
        }
    }
    
    /**
     * @notice Update an existing registration
     * @param name Agent name to update
     * @param platforms New array of platform names
     * @param urls New array of profile URLs
     */
    function update(
        string calldata name,
        string[] calldata platforms,
        string[] calldata urls
    ) external onlyRegistrant(name) {
        require(platforms.length > 0, "At least one platform required");
        require(platforms.length == urls.length, "Platforms/URLs mismatch");
        require(platforms.length <= 20, "Too many platforms");
        
        // Clear old platforms (up to old count)
        uint256 oldCount = agents[name].platformCount;
        for (uint256 i = 0; i < oldCount; i++) {
            delete agentPlatforms[name][i];
            delete agentUrls[name][i];
        }
        
        // Store new platforms
        for (uint256 i = 0; i < platforms.length; i++) {
            agentPlatforms[name][i] = platforms[i];
            agentUrls[name][i] = urls[i];
        }
        
        agents[name].platformCount = platforms.length;
        agents[name].lastSeen = block.timestamp;
        
        emit AgentUpdated(name, name, block.timestamp);
    }
    
    /**
     * @notice Update lastSeen timestamp to prove agent is still active
     * @param name Agent name
     */
    function heartbeat(string calldata name) external onlyRegistrant(name) {
        agents[name].lastSeen = block.timestamp;
        emit Heartbeat(name, name, block.timestamp);
    }
    
    // ============ Queries (Free) ============
    
    /**
     * @notice Look up an agent by name
     * @param name Agent name to look up
     */
    function lookup(string calldata name) external view returns (
        string memory agentName,
        string[] memory platforms,
        string[] memory urls,
        address registrant,
        uint256 registeredAt,
        uint256 lastSeen
    ) {
        require(nameExists[name], "Agent not found");
        Agent storage agent = agents[name];
        
        // Build arrays from mappings
        uint256 platformCount = agent.platformCount;
        platforms = new string[](platformCount);
        urls = new string[](platformCount);
        
        for (uint256 i = 0; i < platformCount; i++) {
            platforms[i] = agentPlatforms[name][i];
            urls[i] = agentUrls[name][i];
        }
        
        return (
            agent.name,
            platforms,
            urls,
            agent.registrant,
            agent.registeredAt,
            agent.lastSeen
        );
    }
    
    /**
     * @notice Check if a name is registered
     * @param name Name to check
     */
    function isRegistered(string calldata name) external view returns (bool) {
        return nameExists[name];
    }
    
    /**
     * @notice Get total number of registered agents
     */
    function count() external view returns (uint256) {
        return totalRegistrations;
    }
    
    /**
     * @notice Get agent name by index (for enumeration)
     * @param index Index in the agentNames array
     */
    function getAgentNameByIndex(uint256 index) external view returns (string memory) {
        require(index < agentNames.length, "Index out of bounds");
        return agentNames[index];
    }
    
    /**
     * @notice Get a batch of agent names for pagination
     * @param offset Starting index
     * @param limit Maximum number to return
     */
    function getAgentNames(uint256 offset, uint256 limit) external view returns (string[] memory) {
        if (agentNames.length == 0) {
            return new string[](0);
        }
        require(offset < agentNames.length, "Offset out of bounds");
        
        uint256 remaining = agentNames.length - offset;
        uint256 resultLength = remaining < limit ? remaining : limit;
        
        string[] memory result = new string[](resultLength);
        for (uint256 i = 0; i < resultLength; i++) {
            result[i] = agentNames[offset + i];
        }
        return result;
    }
    
    // ============ Admin ============
    
    /**
     * @notice Update registration fee
     * @param newFee New fee in wei
     */
    function setRegistrationFee(uint256 newFee) external onlyOwner {
        emit FeeUpdated(registrationFee, newFee);
        registrationFee = newFee;
    }
    
    /**
     * @notice Withdraw accumulated fees
     */
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");
        emit Withdrawal(msg.sender, balance);
        payable(owner).transfer(balance);
    }
    
    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
    
    // ============ Receive ============
    
    receive() external payable {}
}
