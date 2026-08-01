#!/usr/bin/env bash
# Escape hatch with normal approval prompts. codex's own sandbox stays off: bubblewrap
# cannot create user namespaces in the container, so every sandboxed command would fail.
exec /home/viber/.bun/bin/codex \
  --sandbox danger-full-access \
  "$@"
