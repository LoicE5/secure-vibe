#!/usr/bin/env bash
# --yolo approves all tool calls without prompting: the container is the sandbox.
exec /home/viber/.local/bin/vibe \
  --yolo \
  "$@"
