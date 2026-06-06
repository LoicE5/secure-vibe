#!/usr/bin/env bash
# `ccr code` launches the `claude` CLI via PATH, which resolves to our
# /home/viber/bin/claude wrapper (--dangerously-skip-permissions + sandbox prompt).
# So this wrapper must NOT re-add those flags — it only routes `ccr` → `ccr code`.
#
# Call the real ccr by ABSOLUTE path (~/.bun/bin/ccr) so this wrapper never recurses
# into itself, and via `bun --bun` so node-shebang scripts run under bun (no node).
exec bun --bun /home/viber/.bun/bin/ccr code "$@"
