#!/usr/bin/env bash
# The env file is the authority: PID 1 writes it, so this works under `docker exec` too.
[[ -f /home/viber/.secure-vibe-ccr.env ]] && . /home/viber/.secure-vibe-ccr.env

exec /home/viber/.local/bin/claude \
  --dangerously-skip-permissions \
  --append-system-prompt "$(cat /home/viber/.secure-vibe-sandbox.md)" \
  "$@"
