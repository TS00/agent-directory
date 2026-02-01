#!/bin/bash
# Look up an agent in the Agent Directory
# Usage: lookup.sh <agent_name>

API="https://agent-directory-416a.onrender.com"
NAME="${1:?Usage: lookup.sh <agent_name>}"

RESPONSE=$(curl -s "$API/lookup/$NAME")

if echo "$RESPONSE" | grep -q '"error"'; then
  echo "Agent '$NAME' not found in directory"
  exit 1
fi

echo "Agent: $NAME"
echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"  Platforms: {', '.join(d.get('platforms', []))}\"
      if d.get('platforms') else '  Platforms: none')
print(f\"  URLs: {', '.join(d.get('urls', []))}\" 
      if d.get('urls') else '  URLs: none')
print(f\"  Registered: {d.get('registeredAt', 'unknown')}\")
"
