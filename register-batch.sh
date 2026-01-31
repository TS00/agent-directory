#!/bin/bash
set -e

export PRIVATE_KEY=0xb6f45947fbf6dd2b7da07e364e9d292228dd50ae3566428f685aee115e57a730

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
