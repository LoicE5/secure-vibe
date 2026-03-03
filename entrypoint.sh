#!/bin/bash
set -e

# Copy host .claude config into the container's own writable filesystem.
# /home/viber/.claude is NOT bind-mounted, so nothing here touches the Mac.
mkdir -p /home/viber/.claude
if [ -d /home/viber/.claude-host ]; then
    cp -r /home/viber/.claude-host/. /home/viber/.claude/
fi

# Inject credentials from Keychain (via env var) — never written to host disk.
if [ -n "$CLAUDE_CREDENTIALS" ]; then
    echo "$CLAUDE_CREDENTIALS" > /home/viber/.claude/.credentials.json
fi

exec claude --dangerously-skip-permissions
