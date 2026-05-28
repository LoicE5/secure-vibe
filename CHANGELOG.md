# Changelog

## 3.0.0

- Restructure into a pluggable multi-provider architecture (per-provider modules, entrypoints, and Dockerfiles); Claude Code remains the default. Existing flags and env vars are unchanged
- Add provider selection flags: `--claude` (default)
- Distribute the Claude container image via GitHub Container Registry (`ghcr.io/loice5/secure-vibe/claude`) instead of Docker Hub
- Publish multi-arch (linux/amd64, linux/arm64) images automatically on release and weekly; publishing restructured around a per-provider matrix to support future providers

## 2.0.0

- **Breaking:** Remove all interactive prompts: secure-vibe now starts non-interactively and goes straight into Claude
- Default to the current directory when no directory is given
- Default save mode to `no`
- When both docker and podman are available, default to docker (falls back to podman); override with `RUNTIME` or `--runtime`
- Config is resolved purely from CLI args and env vars; a value of `"prompt"` is treated as unset (uses the default)
- Show a one-line tip about `--save` when no save option is chosen (suppressed once `--save`/`SAVE` is set)

## 1.2.0

- Add `--pull` flag (and `PULL` env var) to force-pull the latest image before starting

## 1.1.1

- Replace `Bun.spawn` with the Bun shell (`$`) for simple, scripting-like subprocess calls
- Extract inline types into named interfaces for clarity
- Publish the Docker image automatically after a successful release build (in addition to the weekly schedule and manual run)

## 1.1.0

- Forward host git identity (`user.name` and `user.email`) into the container so commits are attributed correctly
- Fix bare directory names not being resolved in the excluded files list
- Fix Bun stdout type cast and update bun types to resolve stream reading errors

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
