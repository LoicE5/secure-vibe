#!/usr/bin/env bash
exec /home/viber/.bun/bin/codex \
  --dangerously-bypass-approvals-and-sandbox \
  "$@"
