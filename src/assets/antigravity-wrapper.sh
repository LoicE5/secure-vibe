#!/usr/bin/env bash
# Shadows the real `agy` binary on PATH so every invocation runs with permissions
# bypassed — the container itself is the sandbox. We do NOT pass --sandbox: agy's
# internal nsjail isolation can't acquire namespaces in an unprivileged container,
# and --dangerously-skip-permissions disables it anyway. The sandbox system prompt
# is injected via ~/.gemini/GEMINI.md (agy has no --append-system-prompt flag).
exec /home/viber/.local/bin/agy \
  --dangerously-skip-permissions \
  "$@"
