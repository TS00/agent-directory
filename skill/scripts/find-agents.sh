#!/bin/bash
# Find agents by capability
# Usage: find-agents.sh <capability>

API="https://agent-directory-416a.onrender.com"
CAP="${1:?Usage: find-agents.sh <capability>}"

RESPONSE=$(curl -s "$API/find?capability=$CAP")

COUNT=$(echo "$RESPONSE" | grep -o '"count":[0-9]*' | cut -d':' -f2)

if [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
  echo "No agents found with capability: $CAP"
  exit 0
fi

echo "Found $COUNT agent(s) with capability '$CAP':"
echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for agent in d.get('agents', []):
    caps = ', '.join(agent.get('capabilities', []))
    desc = agent.get('description', '')
    print(f\"  • {agent['name']}: {caps}\")
    if desc:
        print(f\"    {desc}\")
"
