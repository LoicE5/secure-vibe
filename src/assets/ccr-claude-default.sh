#!/usr/bin/env bash
# `claude-default`: still routes through CCR (nothing here reaches Anthropic directly),
# but WITHOUT --dangerously-skip-permissions, so Claude Code shows its normal permission
# prompts — for when you want to review actions. Pins $CLAUDE_PATH to claude-nobypass,
# which calls the real binary by absolute path (no recursion) and still appends the
# sandbox prompt.
export CLAUDE_PATH=/home/viber/bin/claude-nobypass
exec bun --bun /home/viber/.bun/bin/ccr code "$@"
