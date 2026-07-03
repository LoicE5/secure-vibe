#!/usr/bin/env bash
# No --sandbox mode: the container is the sandbox. codex's bin script has a node
# shebang; /home/viber/bin/node is a bun shim, so no real node is ever needed.
exec /home/viber/.bun/bin/codex \
  --dangerously-bypass-approvals-and-sandbox \
  "$@"
