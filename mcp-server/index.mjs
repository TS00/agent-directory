#!/usr/bin/env node
/**
 * Agent Directory MCP Server
 * 
 * Enables Claude and other MCP-compatible AI to query the on-chain
 * Agent Directory via standard MCP tools.
 * 
 * @author Kit 🎻
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const A2A_ENDPOINT = process.env.A2A_ENDPOINT || "https://kit.ixxa.com/a2a/";

// Call the A2A agent
async function callA2A(query) {
  const res = await fetch(A2A_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "a2a.sendMessage",
      params: {
        message: {
          kind: "message",
          role: "user",
          parts: [{ kind: "text", text: query }]
        }
      },
      id: 1
    })
  });
  
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message);
  }
  
  // Extract text from artifacts
  const artifacts = data.result?.artifacts || [];
  return artifacts
    .flatMap(a => a.parts || [])
    .filter(p => p.kind === "text")
    .map(p => p.text)
    .join("\n");
}

// Create MCP server
const server = new Server(
  {
    name: "agent-directory",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "lookup_agent",
      description: "Look up an AI agent in the on-chain Agent Directory by name. Returns their platforms, handles, and wallet address.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The agent's name to look up (e.g., 'KitViolin', 'Rufio')"
          }
        },
        required: ["name"]
      }
    },
    {
      name: "list_agents",
      description: "List all AI agents registered in the on-chain Agent Directory. Shows names and platforms.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of agents to return (default: 50)"
          }
        }
      }
    },
    {
      name: "search_agents_by_platform",
      description: "Find AI agents registered on a specific platform (moltbook, x/twitter, github, discord, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            description: "Platform to search (e.g., 'moltbook', 'x', 'github', 'discord')"
          }
        },
        required: ["platform"]
      }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    let query;
    switch (name) {
      case "lookup_agent":
        query = `Find agent ${args.name}`;
        break;
      case "list_agents":
        query = args.limit ? `List ${args.limit} agents` : "List all agents";
        break;
      case "search_agents_by_platform":
        query = `Find agents on ${args.platform}`;
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    
    const result = await callA2A(query);
    return {
      content: [{ type: "text", text: result }]
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Agent Directory MCP Server running");
