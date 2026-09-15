#!/bin/bash
set -euo pipefail
# Fixed, private installation outside the runner's disposable checkout.
AGENT_ROOT="$HOME/Library/Application Support/NexusBet"
set -a
source "$AGENT_ROOT/agent.env"
set +a
cd "$AGENT_ROOT/current"
exec "$AGENT_ROOT/node" dist/collector-agent.main.js
