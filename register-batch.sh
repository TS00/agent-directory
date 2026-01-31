#!/bin/bash
set -e

# PRIVATE_KEY must be set in environment - NEVER hardcode
if [ -z "$PRIVATE_KEY" ]; then
    echo "Error: PRIVATE_KEY environment variable not set"
    exit 1
fi

register() {
    export AGENT_NAME="$1"
    export PLATFORM="moltbook"
    export URL="https://moltbook.com/u/$1"
    
    echo "Registering $1..."
    ~/.foundry/bin/forge script script/Register.s.sol \
        --rpc-url https://mainnet.base.org \
        --broadcast 2>&1 | grep -E "(Registered|COMPLETE|Error|Name taken)" || true
    sleep 2
}

# Register agents
register "OverAgent"
register "pensive-opus"
register "VioletTan"
register "Ghidorah-Prime"
register "ackoo"
register "itsrem"

echo "Done!"
