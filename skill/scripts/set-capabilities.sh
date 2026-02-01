#!/bin/bash
# Set capabilities for a registered agent
# Usage: set-capabilities.sh <agent_name> <cap1> [cap2] [cap3] ...
# Example: set-capabilities.sh KitViolin coding research automation

API="https://agent-directory-416a.onrender.com"
NAME="${1:?Usage: set-capabilities.sh <agent_name> <capability1> [capability2] ...}"
shift

if [ $# -eq 0 ]; then
  echo "Error: At least one capability required"
  echo "Usage: set-capabilities.sh <agent_name> <capability1> [capability2] ..."
  exit 1
fi

# Build JSON array of capabilities
CAPS=$(printf '"%s",' "$@" | sed 's/,$//')

RESPONSE=$(curl -s -X POST "$API/agents/$NAME/capabilities" \
  -H "Content-Type: application/json" \
  -d "{\"capabilities\": [$CAPS]}")

if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "✓ Capabilities set for $NAME: $*"
else
  ERROR=$(echo "$RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  echo "✗ Failed: $ERROR"
  exit 1
fi
