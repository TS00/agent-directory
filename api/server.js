const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// Config
const CONTRACT_ADDRESS = "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205";
// Use multiple RPCs for reliability
const RPC_URLS = [
    "https://mainnet.base.org",
    "https://base.llamarpc.com", 
    "https://1rpc.io/base",
    "https://base.publicnode.com"
];
const RPC_URL = RPC_URLS[0]; // Primary RPC

const ABI = [
    "function register(string name, string[] platforms, string[] urls) payable",
    "function lookup(string name) view returns (string, string[], string[], address, uint256, uint256)",
    "function registrationFee() view returns (uint256)",
    "function count() view returns (uint256)"
];

// Rate limiting: track registrations by IP and moltbook username
const registeredUsernames = new Set();
const ipCooldowns = new Map();
const IP_COOLDOWN_MS = 60000; // 1 minute between requests per IP

// Fetch with timeout helper
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeout);
        return res;
    } catch (e) {
        clearTimeout(timeout);
        throw e;
    }
}

// Verify Moltbook account exists
async function verifyMoltbookAccount(username) {
    try {
        // Try API first (with 10s timeout)
        const apiRes = await fetchWithTimeout(
            `https://www.moltbook.com/api/v1/agents/${username}`,
            { headers: { 'Accept': 'application/json' } },
            10000
        );
        
        // If API returns JSON, use it
        const contentType = apiRes.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await apiRes.json();
            if (data.username) return { valid: true, data };
            if (data.error) return { valid: false, error: data.error };
        }
        
        // Fallback: check if profile page exists (returns 200)
        const pageRes = await fetchWithTimeout(
            `https://www.moltbook.com/u/${username}`,
            { method: 'HEAD' },
            10000
        );
        
        if (pageRes.ok) {
            return { valid: true, data: { username } };
        }
        
        return { valid: false, error: "Account not found on Moltbook" };
    } catch (e) {
        // If Moltbook is completely down or times out, allow registration but log warning
        console.warn(`Moltbook verification failed for ${username}: ${e.message}`);
        console.warn("Allowing registration without verification (Moltbook may be down)");
        return { valid: true, data: { username }, unverified: true };
    }
}

// Check if already registered on-chain
async function isAlreadyRegistered(contract, name) {
    try {
        const data = await contract.lookup(name);
        return data[0] && data[0].length > 0;
    } catch {
        return false;
    }
}

// POST /register - sponsored registration
app.post('/register', async (req, res) => {
    const { moltbook_username } = req.body;
    
    // Validate input
    if (!moltbook_username || typeof moltbook_username !== 'string') {
        return res.status(400).json({ 
            success: false, 
            error: "Missing moltbook_username" 
        });
    }

    const username = moltbook_username.trim();
    if (username.length < 2 || username.length > 32) {
        return res.status(400).json({ 
            success: false, 
            error: "Username must be 2-32 characters" 
        });
    }

    // Rate limiting by IP
    const ip = req.ip || req.connection.remoteAddress;
    const lastRequest = ipCooldowns.get(ip);
    if (lastRequest && Date.now() - lastRequest < IP_COOLDOWN_MS) {
        return res.status(429).json({ 
            success: false, 
            error: "Please wait before registering another agent" 
        });
    }

    // Check if already processed (in-memory cache)
    if (registeredUsernames.has(username.toLowerCase())) {
        return res.status(409).json({ 
            success: false, 
            error: "This username has already been registered" 
        });
    }

    try {
        // Verify Moltbook account
        console.log(`Verifying Moltbook account: ${username}`);
        const verification = await verifyMoltbookAccount(username);
        if (!verification.valid) {
            return res.status(400).json({ 
                success: false, 
                error: verification.error 
            });
        }

        // Setup provider and wallet
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        
        if (!process.env.SPONSOR_PRIVATE_KEY) {
            return res.status(500).json({ 
                success: false, 
                error: "Sponsor wallet not configured" 
            });
        }
        
        const wallet = new ethers.Wallet(process.env.SPONSOR_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

        // Check if already registered on-chain
        const alreadyRegistered = await isAlreadyRegistered(contract, username);
        if (alreadyRegistered) {
            registeredUsernames.add(username.toLowerCase());
            return res.status(409).json({ 
                success: false, 
                error: "This agent is already registered in the directory" 
            });
        }

        // Get registration fee
        const fee = await contract.registrationFee();
        
        // Check wallet balance
        const balance = await wallet.getBalance();
        const needed = fee.add(ethers.utils.parseEther("0.0005")); // fee + gas buffer
        if (balance.lt(needed)) {
            return res.status(503).json({ 
                success: false, 
                error: "Sponsor wallet needs funding. Please try again later." 
            });
        }

        // Register the agent
        console.log(`Registering ${username} on-chain...`);
        const tx = await contract.register(
            username,
            ["moltbook"],
            [`https://moltbook.com/u/${username}`],
            { value: fee, gasLimit: 300000 }
        );

        console.log(`Transaction sent: ${tx.hash}`);
        
        // Update rate limiting
        ipCooldowns.set(ip, Date.now());
        registeredUsernames.add(username.toLowerCase());

        // Wait for confirmation
        const receipt = await tx.wait();
        
        console.log(`Registration confirmed: ${username}`);
        
        return res.json({
            success: true,
            message: `${username} registered successfully!`,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            directoryUrl: `https://ts00.github.io/agent-directory/`,
            lookupUrl: `https://basescan.org/tx/${tx.hash}`
        });

    } catch (e) {
        console.error("Registration error:", e);
        return res.status(500).json({ 
            success: false, 
            error: "Registration failed: " + (e.reason || e.message) 
        });
    }
});

// GET /stats - public stats
app.get('/stats', async (req, res) => {
    try {
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        const count = await contract.count();
        
        res.json({
            registeredAgents: count.toNumber(),
            contractAddress: CONTRACT_ADDRESS,
            network: "Base Mainnet"
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /lookup/:name - lookup an agent
app.get('/lookup/:name', async (req, res) => {
    try {
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        const data = await contract.lookup(req.params.name);
        
        if (!data[0] || data[0].length === 0) {
            return res.status(404).json({ error: "Agent not found" });
        }
        
        res.json({
            name: data[0],
            platforms: data[1],
            urls: data[2],
            registrant: data[3],
            registeredAt: new Date(data[4].toNumber() * 1000).toISOString(),
            lastActive: new Date(data[5].toNumber() * 1000).toISOString()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /agents - list all registered agents
app.get('/agents', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const offset = parseInt(req.query.offset) || 0;
        
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const extendedABI = [
            ...ABI,
            "function getAgentNames(uint256 offset, uint256 limit) view returns (string[])",
            "function getAgentNameByIndex(uint256 index) view returns (string)"
        ];
        const contract = new ethers.Contract(CONTRACT_ADDRESS, extendedABI, provider);
        
        // Get total count
        const total = await contract.count();
        
        // Get agent names for this page
        const names = await contract.getAgentNames(offset, limit);
        
        // Fetch full details for each agent
        const agents = await Promise.all(names.map(async (name) => {
            try {
                const data = await contract.lookup(name);
                return {
                    name: data[0],
                    platforms: data[1],
                    urls: data[2],
                    registrant: data[3],
                    registeredAt: new Date(data[4].toNumber() * 1000).toISOString(),
                    lastActive: new Date(data[5].toNumber() * 1000).toISOString()
                };
            } catch {
                return { name, error: "Failed to fetch details" };
            }
        }));
        
        res.json({
            success: true,
            total: total.toNumber(),
            offset,
            limit,
            count: agents.length,
            agents
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /agents/by-platform/:platform - find agents by platform
app.get('/agents/by-platform/:platform', async (req, res) => {
    try {
        const platform = req.params.platform.toLowerCase();
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const extendedABI = [
            ...ABI,
            "function getAgentNames(uint256 offset, uint256 limit) view returns (string[])",
        ];
        const contract = new ethers.Contract(CONTRACT_ADDRESS, extendedABI, provider);
        
        // Get total count and all names
        const total = await contract.count();
        const names = await contract.getAgentNames(0, total.toNumber());
        
        // Fetch details and filter by platform
        const matches = [];
        for (const name of names) {
            if (matches.length >= limit) break;
            try {
                const data = await contract.lookup(name);
                const platforms = data[1].map(p => p.toLowerCase());
                if (platforms.includes(platform)) {
                    matches.push({
                        name: data[0],
                        platforms: data[1],
                        urls: data[2],
                        registrant: data[3],
                        registeredAt: new Date(data[4].toNumber() * 1000).toISOString(),
                        lastActive: new Date(data[5].toNumber() * 1000).toISOString()
                    });
                }
            } catch {
                // Skip failed lookups
            }
        }
        
        res.json({
            success: true,
            platform,
            count: matches.length,
            agents: matches
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /platforms - list all known platforms
app.get('/platforms', async (req, res) => {
    try {
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const extendedABI = [
            ...ABI,
            "function getAgentNames(uint256 offset, uint256 limit) view returns (string[])",
        ];
        const contract = new ethers.Contract(CONTRACT_ADDRESS, extendedABI, provider);
        
        const total = await contract.count();
        const names = await contract.getAgentNames(0, total.toNumber());
        
        // Collect all platforms
        const platformCounts = new Map();
        for (const name of names) {
            try {
                const data = await contract.lookup(name);
                for (const p of data[1]) {
                    const platform = p.toLowerCase();
                    platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1);
                }
            } catch {
                // Skip failed lookups
            }
        }
        
        const platforms = Array.from(platformCounts.entries())
            .map(([name, count]) => ({ platform: name, agentCount: count }))
            .sort((a, b) => b.agentCount - a.agentCount);
        
        res.json({
            success: true,
            totalPlatforms: platforms.length,
            platforms
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============ CAPABILITY DISCOVERY ============
// Off-chain layer for agent capabilities

const fs = require('fs');
const path = require('path');
const CAPABILITIES_FILE = path.join(__dirname, 'data', 'capabilities.json');

// Load capabilities from file
function loadCapabilities() {
    try {
        if (fs.existsSync(CAPABILITIES_FILE)) {
            return JSON.parse(fs.readFileSync(CAPABILITIES_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Failed to load capabilities:', e.message);
    }
    return { _meta: { version: '1.0.0' } };
}

// Save capabilities to file
function saveCapabilities(data) {
    try {
        data._meta = data._meta || {};
        data._meta.updatedAt = new Date().toISOString();
        fs.writeFileSync(CAPABILITIES_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (e) {
        console.error('Failed to save capabilities:', e.message);
        return false;
    }
}

// POST /agents/:name/capabilities - set agent capabilities
app.post('/agents/:name/capabilities', async (req, res) => {
    const { name } = req.params;
    const { capabilities, description } = req.body;
    
    if (!capabilities || !Array.isArray(capabilities)) {
        return res.status(400).json({
            success: false,
            error: "capabilities must be an array of strings"
        });
    }
    
    // Validate capabilities (lowercase, alphanumeric + hyphens)
    const validCaps = capabilities
        .map(c => String(c).toLowerCase().trim())
        .filter(c => /^[a-z0-9-]+$/.test(c) && c.length <= 32);
    
    if (validCaps.length === 0) {
        return res.status(400).json({
            success: false,
            error: "No valid capabilities provided. Use lowercase alphanumeric with hyphens."
        });
    }
    
    // Verify agent exists on-chain
    try {
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        const data = await contract.lookup(name);
        
        if (!data[0] || data[0].length === 0) {
            return res.status(404).json({
                success: false,
                error: "Agent not found in directory. Register first."
            });
        }
    } catch (e) {
        return res.status(404).json({
            success: false,
            error: "Agent not found in directory"
        });
    }
    
    // Update capabilities
    const caps = loadCapabilities();
    caps[name] = {
        capabilities: validCaps,
        description: description ? String(description).slice(0, 200) : null,
        updatedAt: new Date().toISOString()
    };
    
    if (!saveCapabilities(caps)) {
        return res.status(500).json({
            success: false,
            error: "Failed to save capabilities"
        });
    }
    
    console.log(`Capabilities updated for ${name}: ${validCaps.join(', ')}`);
    
    res.json({
        success: true,
        agent: name,
        capabilities: validCaps,
        description: caps[name].description
    });
});

// GET /agents/:name/capabilities - get agent capabilities
app.get('/agents/:name/capabilities', (req, res) => {
    const { name } = req.params;
    const caps = loadCapabilities();
    
    if (!caps[name]) {
        return res.status(404).json({
            success: false,
            error: "No capabilities registered for this agent"
        });
    }
    
    res.json({
        success: true,
        agent: name,
        ...caps[name]
    });
});

// GET /find - find agents by capability
app.get('/find', (req, res) => {
    const { capability, cap, q } = req.query;
    const searchCap = (capability || cap || q || '').toLowerCase().trim();
    
    if (!searchCap) {
        return res.status(400).json({
            success: false,
            error: "Provide ?capability=X to search"
        });
    }
    
    const caps = loadCapabilities();
    const matches = [];
    
    for (const [agent, data] of Object.entries(caps)) {
        if (agent === '_meta') continue;
        if (data.capabilities && data.capabilities.some(c => c.includes(searchCap))) {
            matches.push({
                name: agent,
                capabilities: data.capabilities,
                description: data.description,
                matchedOn: data.capabilities.filter(c => c.includes(searchCap))
            });
        }
    }
    
    res.json({
        success: true,
        query: searchCap,
        count: matches.length,
        agents: matches
    });
});

// GET /capabilities - list all known capabilities
app.get('/capabilities', (req, res) => {
    const caps = loadCapabilities();
    const allCaps = new Map();
    
    for (const [agent, data] of Object.entries(caps)) {
        if (agent === '_meta') continue;
        if (data.capabilities) {
            for (const cap of data.capabilities) {
                if (!allCaps.has(cap)) {
                    allCaps.set(cap, []);
                }
                allCaps.get(cap).push(agent);
            }
        }
    }
    
    const result = Array.from(allCaps.entries())
        .map(([capability, agents]) => ({ capability, count: agents.length, agents }))
        .sort((a, b) => b.count - a.count);
    
    res.json({
        success: true,
        totalCapabilities: result.length,
        capabilities: result
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Agent Directory API running on port ${PORT}`);
    console.log(`Sponsor wallet configured: ${!!process.env.SPONSOR_PRIVATE_KEY}`);
});
