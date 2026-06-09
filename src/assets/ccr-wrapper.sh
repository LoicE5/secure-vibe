#!/usr/bin/env bash
# Used for BOTH `/home/viber/bin/claude` and `/home/viber/bin/ccr`. The whole point of
# the CCR container is to route through claude-code-router, so the bare `claude` command
# routes through it too (a direct-to-Anthropic claude would defeat the container).
#
# `ccr code` launches the inner claude via $CLAUDE_PATH. We pin it to claude-bypass
# (--dangerously-skip-permissions + sandbox prompt) — that inner wrapper calls the REAL
# binary by absolute path, so this never recurses. Call the real ccr by ABSOLUTE path
# (~/.bun/bin/ccr) via `bun --bun` so node-shebang scripts run under bun (no node).
export CLAUDE_PATH=/home/viber/bin/claude-bypass
exec bun --bun /home/viber/.bun/bin/ccr code "$@"
