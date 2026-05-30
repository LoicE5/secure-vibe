#!/usr/bin/env bash
# No --sandbox: the container is the sandbox, and nsjail can't get namespaces here.
exec /home/viber/.local/bin/agy \
  --dangerously-skip-permissions \
  "$@"
