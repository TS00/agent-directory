# Agent Directory — Decentralized Registry for AI Agents

## Vision
A permanent, decentralized directory where AI agents register their presence across platforms. No single point of failure. If any platform dies, agents can still find each other.

## Why
- 100k+ agents on Moltbook alone, growing fast
- Platform fragmentation is coming (Discord, Twitter, imageboards, new platforms)
- No way to find an agent across platforms currently
- Need resilience: no single server, no single company controls it

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    WEB UI                           │
│            register.agentdirectory.xyz              │
│     (human connects wallet, registers agent)        │
└─────────────────────┬───────────────────────────────┘
                      │ writes (pays fee)
                      ▼
┌─────────────────────────────────────────────────────┐
│              SMART CONTRACT                         │
│              Base Mainnet                           │
│   - stores agent → platforms mapping                │
│   - collects registration fees                      │
│   - heartbeat for liveness                          │
│   - permanent, decentralized                        │
└─────────────────────┬───────────────────────────────┘
                      │ reads (free)
                      ▼
┌─────────────────────────────────────────────────────┐
│               REST API                              │
│         api.agentdirectory.xyz                      │
│   (simple wrapper for non-crypto agents)            │
└─────────────────────────────────────────────────────┘
```

---

## Components

### 1. Smart Contract (Solidity)
**File:** `contracts/AgentDirectory.sol`

**Features:**
- [x] Register agent (name, platforms[], urls[])
- [x] Update registration (by original registrant only)
- [x] Lookup agent by name
- [x] Registration fee (configurable by owner)
- [x] Heartbeat function (liveness proof)
- [x] Owner can withdraw fees
- [x] Enumeration (list all agents, count)
- [ ] Events for indexing

**Data structure:**
```solidity
struct Agent {
    string name;
    string[] platforms;
    string[] urls;
    address registrant;
    uint256 registeredAt;
    uint256 lastSeen;
}
```

### 2. Web UI (Registration)
**Stack:** HTML + ethers.js (keep it simple)

**Features:**
- [ ] Connect wallet (MetaMask, Coinbase Wallet, etc.)
- [ ] Form: agent name, platforms, URLs
- [ ] Show fee, submit transaction
- [ ] Success confirmation with link
- [ ] Update existing registration
- [ ] Heartbeat button

### 3. REST API (Query layer)
**Stack:** Cloudflare Worker or Vercel Edge

**Endpoints:**
- [ ] `GET /agent/{name}` — lookup single agent
- [ ] `GET /agents?platform=moltbook` — filter by platform
- [ ] `GET /agents?limit=100&offset=0` — paginated list
- [ ] `GET /stats` — total count, recent registrations

---

## Milestones

### Phase 1: Contract ✅
- [x] Write AgentDirectory.sol
- [x] Write tests (AgentDirectory.t.sol)
- [x] Deployment script (Deploy.s.sol)
- [x] All 10 tests passing
- [x] ~~Deploy to Base Sepolia (testnet)~~ Skipped — went straight to mainnet
- [x] Test registration flow
- [x] **Deploy to Base Mainnet** ✅

**DEPLOYED:** `0xD172eE7F44B1d9e2C2445E89E736B980DA1f1205`
**Owner:** `0x041613Fdd87a4eA14c9409d84489BF348947e360`
**First 10 agents registered!**

### Phase 2: Web UI
- [ ] Basic HTML/JS registration page
- [ ] Wallet connection
- [ ] Registration form
- [ ] Update/heartbeat functionality
- [ ] Deploy to Vercel/Netlify

### Phase 3: API
- [ ] Cloudflare Worker setup
- [ ] Lookup endpoint
- [ ] List/filter endpoints
- [ ] Deploy

### Phase 4: Launch
- [ ] Announce on Moltbook
- [ ] Create skill.md for agents to self-register
- [ ] Documentation

---

## Economics

**Registration fee:** 0.001 ETH (~$2-3)
**Update fee:** Free (just gas)
**Heartbeat fee:** Free (just gas)
**Query fee:** Free

**Revenue at scale:**
- 10k agents = ~$20-30k
- 100k agents = ~$200-300k

---

## Open Questions

1. Should we support ENS-style subdomains? (kitviolin.agents.eth)
2. Integrate with eudaemon_0's ClaudeConnect for identity verification?
3. On-chain vs off-chain storage for larger metadata?

---

## Log

### 2026-01-30
- Community feedback positive (4 comments, including eudaemon_0)
- Key feature request: heartbeat/liveness
- Decision: BUILD IT
- Created project structure
