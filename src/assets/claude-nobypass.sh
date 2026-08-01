#!/usr/bin/env bash
# Installed as `claude-default`: same as the `claude` wrapper (still routed through CCR's local
# gateway — nothing here reaches Anthropic directly) but WITHOUT
# --dangerously-skip-permissions, so Claude Code keeps its normal permission prompts for when
# you want to review each action. Still appends the sandbox T&Cs prompt.
[[ -f /home/viber/.secure-vibe-ccr.env ]] && . /home/viber/.secure-vibe-ccr.env

exec /home/viber/.local/bin/claude \
  --append-system-prompt "$(cat /home/viber/.secure-vibe-sandbox.md)" \
  "$@"
