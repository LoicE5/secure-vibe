# secure-vibe: the agy installer prepends ~/.local/bin here, shadowing our wrapper, so
# re-assert /home/viber/bin last and clear bash's command hash.
export PATH="/home/viber/bin:$PATH"
hash -r 2>/dev/null || true

if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then
  agy || true
  echo ""
  echo "Antigravity exited. Type 'agy' to restart."
fi
