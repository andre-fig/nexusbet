#!/bin/bash
set -euo pipefail
: "${AGENT_RELEASE_ID:?release SHA required}"
[[ "$AGENT_RELEASE_ID" =~ ^[a-f0-9]{40}$ ]] || exit 1
AGENT_ROOT="$HOME/Library/Application Support/NexusBet"
AGENT_RELEASE="$AGENT_ROOT/releases/$AGENT_RELEASE_ID"
test -f "$AGENT_ROOT/agent.env"
test -x "$AGENT_ROOT/node"
mkdir -p "$AGENT_RELEASE"
# Build is complete before changing the running release. Never copy .env or captures.
rsync -a --delete dist node_modules package.json "$AGENT_RELEASE/"
cp runtime/agent/run-macos.sh "$AGENT_ROOT/run-macos.sh"
chmod 700 "$AGENT_ROOT/run-macos.sh"
AGENT_PREVIOUS="$(readlink "$AGENT_ROOT/current" || true)"
ln -sfn "$AGENT_RELEASE" "$AGENT_ROOT/current.next"
mv -fh "$AGENT_ROOT/current.next" "$AGENT_ROOT/current"
# launchctl kill delivers SIGTERM; KeepAlive restarts after graceful process exit.
if ! launchctl kill SIGTERM "gui/$(id -u)/com.nexusbet.collector-agent"; then
  if [ -n "$AGENT_PREVIOUS" ]; then
    ln -sfn "$AGENT_PREVIOUS" "$AGENT_ROOT/current.next"
    mv -fh "$AGENT_ROOT/current.next" "$AGENT_ROOT/current"
  fi
  exit 1
fi
