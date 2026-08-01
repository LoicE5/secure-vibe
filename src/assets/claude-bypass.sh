#!/usr/bin/env bash
# Installed as BOTH `claude` and `ccr`. The whole point of this container is to route through
# claude-code-router, so the bare `claude` command routes through it too — but in CCR 3.x that
# means talking to the local gateway (`ccr serve`, started by the entrypoint) over
# $ANTHROPIC_BASE_URL, not being spawned by `ccr code`, which no longer exists.
#
# The env file is the authority: PID 1 writes it, so this also works under `docker exec`,
# which inherits nothing. Execs the REAL claude by absolute path so PATH can never recurse.
[[ -f /home/viber/.secure-vibe-ccr.env ]] && . /home/viber/.secure-vibe-ccr.env

exec /home/viber/.local/bin/claude \
  --dangerously-skip-permissions \
  --append-system-prompt "$(cat /home/viber/.secure-vibe-sandbox.md)" \
  "$@"
