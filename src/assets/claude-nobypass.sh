#!/usr/bin/env bash
[[ -f /home/viber/.secure-vibe-ccr.env ]] && . /home/viber/.secure-vibe-ccr.env

exec /home/viber/.local/bin/claude \
  --append-system-prompt "$(cat /home/viber/.secure-vibe-sandbox.md)" \
  "$@"
