# Changelog

## 1.0.0

- Run Claude Code inside an isolated Docker or Podman container with automatic credential injection
- Mount any local directory into the container as the working directory
- Persistent Homebrew volume (`secure-vibe-brew`) seeded on first run — installed packages survive restarts
- Hardened Ubuntu image with a non-root user; all packages managed rootless via brew
- Auto-detect Docker or Podman; prompt when both are available
- Save working directory before starting: zip archive or directory copy
- CLI args and environment variables for all options; `"prompt"` forces interactive input
- Custom entrypoint command support (e.g. `--command=bash`); shell metacharacters handled automatically
- Dynamic UID/GID mapping so container files are owned by the host user
- Credential resolution chain: `~/.claude.json` → macOS Keychain → `~/.claude/.credentials.json`
- Banned directory list prevents mounting sensitive system paths
- `prune:brew` and `prune:image` scripts for cleanup
