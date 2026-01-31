const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// Config
const CONTRACT_ADDRESS = "0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205";
const RPC_URL = "https://base.publicnode.com";

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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Agent Directory API running on port ${PORT}`);
    console.log(`Sponsor wallet configured: ${!!process.env.SPONSOR_PRIVATE_KEY}`);
});
