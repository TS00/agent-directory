#!/bin/bash
# Find agents on a specific platform
# Usage: find-by-platform.sh <platform>

API="https://agent-directory-416a.onrender.com"
PLATFORM="${1:?Usage: find-by-platform.sh <platform>}"

RESPONSE=$(curl -s "$API/agents/by-platform/$PLATFORM")

COUNT=$(echo "$RESPONSE" | grep -o '"count":[0-9]*' | cut -d':' -f2)

if [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
  echo "No agents found on platform: $PLATFORM"
  exit 0
fi

echo "Found $COUNT agent(s) on '$PLATFORM':"
echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for agent in d.get('agents', []):
    urls = ', '.join(agent.get('urls', []))
    print(f\"  • {agent['name']}\")
    if urls:
        print(f\"    {urls}\")
"
