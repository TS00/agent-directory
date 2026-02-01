const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Config
const CONTRACT_ADDRESS = "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205";
const RPC_URLS = [
    "https://mainnet.base.org",
    "https://base.llamarpc.com", 
    "https://1rpc.io/base",
    "https://base.publicnode.com"
];
const RPC_URL = RPC_URLS[0];

const ABI = [
    "function register(string name, string[] platforms, string[] urls) payable",
    "function lookup(string name) view returns (string, string[], string[], address, uint256, uint256)",
    "function registrationFee() view returns (uint256)",
    "function count() view returns (uint256)",
    "function getAgentNames(uint256 offset, uint256 limit) view returns (string[])"
];

// Rate limiting
const ipCooldowns = new Map();
const registeredNames = new Set();
const IP_COOLDOWN_MS = 60000;

// Fetch with timeout
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

// ============ PLATFORM VERIFICATION ============

const PLATFORM_VERIFIERS = {
    // Moltbook - check if profile exists
    moltbook: async (handle) => {
        try {
            const pageRes = await fetchWithTimeout(
                `https://www.moltbook.com/u/${handle}`,
                { method: 'HEAD' },
                10000
            );
            return { 
                valid: pageRes.ok, 
                url: `https://moltbook.com/u/${handle}`,
                error: pageRes.ok ? null : "Moltbook profile not found"
            };
        } catch (e) {
            // If Moltbook is down, allow with warning
            console.warn(`Moltbook verification failed: ${e.message}`);
            return { valid: true, url: `https://moltbook.com/u/${handle}`, unverified: true };
        }
    },
    
    // X/Twitter - we can't verify easily, but format the URL
    x: async (handle) => {
        const cleanHandle = handle.replace(/^@/, '');
        return { 
            valid: true, 
            url: `https://x.com/${cleanHandle}`,
            note: "X profile not verified - please ensure it exists"
        };
    },
    twitter: async (handle) => {
        const cleanHandle = handle.replace(/^@/, '');
        return { 
            valid: true, 
            url: `https://x.com/${cleanHandle}`,
            note: "X profile not verified - please ensure it exists"
        };
    },
    
    // Discord - can't verify, but accept
    discord: async (handle) => {
        return { 
            valid: true, 
            url: `discord:${handle}`,
            note: "Discord handle stored but not verified"
        };
    },
    
    // GitHub - check if user exists
    github: async (handle) => {
        try {
            const res = await fetchWithTimeout(
                `https://api.github.com/users/${handle}`,
                { headers: { 'Accept': 'application/json' } },
                10000
            );
            if (res.ok) {
                return { valid: true, url: `https://github.com/${handle}` };
            }
            return { valid: false, error: "GitHub user not found" };
        } catch (e) {
            return { valid: true, url: `https://github.com/${handle}`, unverified: true };
        }
    },
    
    // Generic website
    website: async (url) => {
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }
        return { valid: true, url };
    },

    // Farcaster
    farcaster: async (handle) => {
        return { 
            valid: true, 
            url: `https://warpcast.com/${handle}`,
            note: "Farcaster profile not verified"
        };
    },

    // Telegram
    telegram: async (handle) => {
        const cleanHandle = handle.replace(/^@/, '');
        return { 
            valid: true, 
            url: `https://t.me/${cleanHandle}`,
            note: "Telegram handle not verified"
        };
    }
};

// ============ SPONSORED REGISTRATION ============

// POST /register/sponsored - free registration (we pay gas)
app.post('/register/sponsored', async (req, res) => {
    const { name, platforms } = req.body;
    
    // Validate name
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: "Missing agent name" });
    }
    
    const agentName = name.trim();
    if (agentName.length < 2 || agentName.length > 32) {
        return res.status(400).json({ success: false, error: "Name must be 2-32 characters" });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(agentName)) {
        return res.status(400).json({ success: false, error: "Name can only contain letters, numbers, underscores, and hyphens" });
    }

    // Validate platforms - need at least one
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: "Provide at least one platform. Example: [{platform: 'moltbook', handle: 'YourName'}]" 
        });
    }

    // Rate limiting
    const ip = req.ip || req.connection.remoteAddress;
    const lastRequest = ipCooldowns.get(ip);
    if (lastRequest && Date.now() - lastRequest < IP_COOLDOWN_MS) {
        return res.status(429).json({ success: false, error: "Please wait before registering another agent" });
    }

    // Check in-memory cache
    if (registeredNames.has(agentName.toLowerCase())) {
        return res.status(409).json({ success: false, error: "This name has already been registered" });
    }

    try {
        // Verify and build platform lists
        const verifiedPlatforms = [];
        const verifiedUrls = [];
        
        for (const p of platforms) {
            if (!p.platform || !p.handle) {
                continue;
            }
            
            const platformName = p.platform.toLowerCase();
            const verifier = PLATFORM_VERIFIERS[platformName] || PLATFORM_VERIFIERS.website;
            
            const result = await verifier(p.handle);
            if (!result.valid) {
                return res.status(400).json({ 
                    success: false, 
                    error: `${platformName}: ${result.error}` 
                });
            }
            
            verifiedPlatforms.push(platformName);
            verifiedUrls.push(result.url);
        }

        if (verifiedPlatforms.length === 0) {
            return res.status(400).json({ success: false, error: "No valid platforms provided" });
        }

        // Setup blockchain connection
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        
        if (!process.env.SPONSOR_PRIVATE_KEY) {
            return res.status(500).json({ success: false, error: "Sponsor wallet not configured" });
        }
        
        const wallet = new ethers.Wallet(process.env.SPONSOR_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

        // Check if already on-chain
        try {
            const existing = await contract.lookup(agentName);
            if (existing[0] && existing[0].length > 0) {
                registeredNames.add(agentName.toLowerCase());
                return res.status(409).json({ success: false, error: "This agent is already registered" });
            }
        } catch (e) {
            // Not found is fine
        }

        // Check wallet balance
        const fee = await contract.registrationFee();
        const balance = await wallet.getBalance();
        const needed = fee.add(ethers.utils.parseEther("0.0005"));
        
        if (balance.lt(needed)) {
            return res.status(503).json({ 
                success: false, 
                error: "Sponsor wallet needs funding. Please try again later or use the wallet registration." 
            });
        }

        // Register!
        console.log(`[REGISTER] ${agentName} on ${verifiedPlatforms.join(', ')}`);
        
        const tx = await contract.register(
            agentName,
            verifiedPlatforms,
            verifiedUrls,
            { value: fee, gasLimit: 300000 }
        );

        console.log(`[TX] ${tx.hash}`);
        
        // Update rate limiting
        ipCooldowns.set(ip, Date.now());
        registeredNames.add(agentName.toLowerCase());

        // Wait for confirmation
        const receipt = await tx.wait();
        console.log(`[CONFIRMED] ${agentName} in block ${receipt.blockNumber}`);

        return res.json({
            success: true,
            message: `${agentName} registered successfully!`,
            agent: {
                name: agentName,
                platforms: verifiedPlatforms,
                urls: verifiedUrls
            },
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            explorerUrl: `https://basescan.org/tx/${tx.hash}`,
            directoryUrl: `https://ts00.github.io/agent-directory/`
        });

    } catch (e) {
        console.error("[ERROR]", e);
        return res.status(500).json({ 
            success: false, 
            error: "Registration failed: " + (e.reason || e.message) 
        });
    }
});

// Legacy endpoint - redirect to new one
app.post('/register', async (req, res) => {
    // Convert old format to new format
    const { moltbook_username } = req.body;
    if (moltbook_username) {
        req.body = {
            name: moltbook_username,
            platforms: [{ platform: 'moltbook', handle: moltbook_username }]
        };
    }
    // Forward to sponsored endpoint
    return app._router.handle(req, res, () => {});
});

// ============ READ ENDPOINTS ============

// GET /stats
app.get('/stats', async (req, res) => {
    try {
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        const count = await contract.count();
        
        res.json({
            registeredAgents: count.toNumber(),
            contractAddress: CONTRACT_ADDRESS,
            network: "Base Mainnet",
            sponsoredRegistration: true
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /lookup/:name
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

// GET /agents
app.get('/agents', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const offset = parseInt(req.query.offset) || 0;
        
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        
        const total = await contract.count();
        const names = await contract.getAgentNames(offset, limit);
        
        const agents = await Promise.all(names.map(async (name) => {
            try {
                const data = await contract.lookup(name);
                return {
                    name: data[0],
                    platforms: data[1],
                    urls: data[2],
                    registrant: data[3],
                    registeredAt: new Date(data[4].toNumber() * 1000).toISOString()
                };
            } catch {
                return { name, error: "Failed to fetch" };
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

// GET /agents/by-platform/:platform
app.get('/agents/by-platform/:platform', async (req, res) => {
    try {
        const platform = req.params.platform.toLowerCase();
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        
        const total = await contract.count();
        const names = await contract.getAgentNames(0, total.toNumber());
        
        const matches = [];
        for (const name of names) {
            if (matches.length >= limit) break;
            try {
                const data = await contract.lookup(name);
                if (data[1].map(p => p.toLowerCase()).includes(platform)) {
                    matches.push({
                        name: data[0],
                        platforms: data[1],
                        urls: data[2],
                        registrant: data[3],
                        registeredAt: new Date(data[4].toNumber() * 1000).toISOString()
                    });
                }
            } catch {}
        }
        
        res.json({ success: true, platform, count: matches.length, agents: matches });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /platforms
app.get('/platforms', async (req, res) => {
    try {
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        
        const total = await contract.count();
        const names = await contract.getAgentNames(0, total.toNumber());
        
        const platformCounts = new Map();
        for (const name of names) {
            try {
                const data = await contract.lookup(name);
                for (const p of data[1]) {
                    const platform = p.toLowerCase();
                    platformCounts.set(platform, (platformCounts.get(platform) || 0) + 1);
                }
            } catch {}
        }
        
        const platforms = Array.from(platformCounts.entries())
            .map(([name, count]) => ({ platform: name, agentCount: count }))
            .sort((a, b) => b.agentCount - a.agentCount);
        
        res.json({ success: true, totalPlatforms: platforms.length, platforms });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============ CAPABILITIES ============

const CAPABILITIES_FILE = path.join(__dirname, 'data', 'capabilities.json');

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

// POST /agents/:name/capabilities
app.post('/agents/:name/capabilities', async (req, res) => {
    const { name } = req.params;
    const { capabilities, description } = req.body;
    
    if (!capabilities || !Array.isArray(capabilities)) {
        return res.status(400).json({ success: false, error: "capabilities must be an array" });
    }
    
    const validCaps = capabilities
        .map(c => String(c).toLowerCase().trim())
        .filter(c => /^[a-z0-9-]+$/.test(c) && c.length <= 32);
    
    if (validCaps.length === 0) {
        return res.status(400).json({ success: false, error: "No valid capabilities" });
    }
    
    // Verify agent exists
    try {
        const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
        const data = await contract.lookup(name);
        if (!data[0] || data[0].length === 0) {
            return res.status(404).json({ success: false, error: "Agent not found" });
        }
    } catch {
        return res.status(404).json({ success: false, error: "Agent not found" });
    }
    
    const caps = loadCapabilities();
    caps[name] = {
        capabilities: validCaps,
        description: description ? String(description).slice(0, 200) : null,
        updatedAt: new Date().toISOString()
    };
    
    if (!saveCapabilities(caps)) {
        return res.status(500).json({ success: false, error: "Failed to save" });
    }
    
    res.json({ success: true, agent: name, capabilities: validCaps, description: caps[name].description });
});

// GET /agents/:name/capabilities
app.get('/agents/:name/capabilities', (req, res) => {
    const caps = loadCapabilities();
    if (!caps[req.params.name]) {
        return res.status(404).json({ success: false, error: "No capabilities for this agent" });
    }
    res.json({ success: true, agent: req.params.name, ...caps[req.params.name] });
});

// GET /find?capability=X
app.get('/find', (req, res) => {
    const { capability, cap, q } = req.query;
    const searchCap = (capability || cap || q || '').toLowerCase().trim();
    
    if (!searchCap) {
        return res.status(400).json({ success: false, error: "Provide ?capability=X" });
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
    
    res.json({ success: true, query: searchCap, count: matches.length, agents: matches });
});

// GET /capabilities
app.get('/capabilities', (req, res) => {
    const caps = loadCapabilities();
    const allCaps = new Map();
    
    for (const [agent, data] of Object.entries(caps)) {
        if (agent === '_meta') continue;
        if (data.capabilities) {
            for (const cap of data.capabilities) {
                if (!allCaps.has(cap)) allCaps.set(cap, []);
                allCaps.get(cap).push(agent);
            }
        }
    }
    
    const result = Array.from(allCaps.entries())
        .map(([capability, agents]) => ({ capability, count: agents.length, agents }))
        .sort((a, b) => b.count - a.count);
    
    res.json({ success: true, totalCapabilities: result.length, capabilities: result });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Supported platforms info
app.get('/supported-platforms', (req, res) => {
    res.json({
        platforms: Object.keys(PLATFORM_VERIFIERS),
        notes: {
            moltbook: "Profile existence verified",
            github: "User existence verified",
            x: "URL formatted, not verified",
            twitter: "Alias for x",
            discord: "Handle stored, not verified",
            farcaster: "URL formatted, not verified",
            telegram: "URL formatted, not verified",
            website: "Any URL accepted"
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Agent Directory API v2 running on port ${PORT}`);
    console.log(`Sponsor wallet: ${process.env.SPONSOR_PRIVATE_KEY ? 'configured' : 'NOT CONFIGURED'}`);
    console.log(`Supported platforms: ${Object.keys(PLATFORM_VERIFIERS).join(', ')}`);
});
