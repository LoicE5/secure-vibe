#!/usr/bin/env bash
# Escape hatch: normal approval prompts, but codex's own sandbox stays off —
# bubblewrap can't create user namespaces inside the container, so every
# sandboxed command would fail. The container is the sandbox.
exec /home/viber/.bun/bin/codex \
  --sandbox danger-full-access \
  "$@"
