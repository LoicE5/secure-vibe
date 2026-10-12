#!/usr/bin/env bash
arguments=("$@")
skip_value=0
for index in "${!arguments[@]}"; do
  argument="${arguments[index]}"
  if [[ $skip_value -eq 1 ]]; then
    skip_value=0
    continue
  fi
  case "$argument" in
    --help|-h|--version|-v)
      exec /home/viber/.opencode/bin/opencode "${arguments[@]}"
      ;;
    --model|-m|--session|-s|--prompt|--agent|--port|--hostname|--log-level|--mdns-domain|--replay-limit)
      skip_value=1
      ;;
    -*) ;;
    run)
      exec /home/viber/.opencode/bin/opencode "${arguments[@]:0:index+1}" --yolo "${arguments[@]:index+1}"
      ;;
    auth|providers|models|debug|mcp|acp|attach|serve|web|upgrade|uninstall|completion|agent|generate|export|import|session|stats|github|pr|plugin|plug|db)
      exec /home/viber/.opencode/bin/opencode "${arguments[@]}"
      ;;
    *) break ;;
  esac
done
exec /home/viber/.opencode/bin/opencode --yolo "${arguments[@]}"
