# Changelog

## 3.8.0

- Add Mistral's **Vibe CLI** (`vibe`) as a selectable provider via `--vibe` (or `--lechat`, `--mistral`, `--miaou`), alongside `--claude`, `--antigravity`, `--ccr`, and `--codex`: its own container image (`ghcr.io/loice5/secure-vibe/vibe`), Dockerfile, entrypoint, and `docker:build:vibe` / `docker:pull:vibe` / `prune:image:vibe` scripts. Runs with your Mistral account or API key
- Start vibe pre-authenticated: resolve the host key in vibe's own persistence order — `MISTRAL_API_KEY` env var → OS keyring (macOS Keychain / Linux Secret Service, service `ai.mistral.vibe`) → `~/.vibe/.env` — and inject it as `MISTRAL_API_KEY`, which vibe reads process-env-first so it always wins in-container. `~/.vibe` is mounted **read-only** (when it exists); nothing is written back to the host
- Install vibe with its official installer (uv bootstrap + `uv tool install mistral-vibe` + a managed CPython ≥ 3.12) into `~/.local` — image layers, not the shadowed brew volume — unpinned, so the weekly image rebuild always ships the latest vibe, with a `vibe --version` build-time smoke check
- Inject the sandbox system prompt into vibe via `~/.vibe/AGENTS.md` (vibe has no `--append-system-prompt` flag; the user-level instructions file is loaded into every session's system prompt)
- Whitelist the workspace in vibe's own trust store (`"/home/viber/app"` in the `trusted` array of `~/.vibe/trusted_folders.toml`) so it skips the workspace-trust dialog
- Bypass tool approvals with `vibe --yolo` via the `/home/viber/bin/vibe` wrapper — the container itself is the sandbox; `vibe-default` is the escape hatch with normal tool-approval prompts (a plain symlink: vibe has no internal OS sandbox to disable)

## 3.7.0

- Add OpenAI's **Codex CLI** (`codex`) as a selectable provider via `--codex` (or `--gpt`), alongside `--claude`, `--antigravity`, and `--ccr`: its own container image (`ghcr.io/loice5/secure-vibe/codex`), Dockerfile, entrypoint, and `docker:build:codex` / `docker:pull:codex` / `prune:image:codex` scripts. Runs with your ChatGPT account or an OpenAI API key
- Start codex pre-authenticated: read the host's plaintext `~/.codex/auth.json` (ChatGPT OAuth tokens or API key — codex uses no keychain on any platform), inject it via env, and write it to the container's own `~/.codex/auth.json` (mode `600`) so the session starts logged in. `~/.codex` is mounted **read-only**; nothing is written back to the host
- Install codex with `bun` (no npm, no node) into `~/.bun` — unpinned, so the weekly image rebuild always ships the latest codex — with a `node`→`bun` shim for its bin script
- Inject the sandbox system prompt into codex via `~/.codex/AGENTS.md` (codex has no `--append-system-prompt` flag; the global instructions file is prepended to every session)
- Whitelist the workspace in codex's own trust store (`[projects."/home/viber/app"]` with `trust_level = "trusted"` in `~/.codex/config.toml`) so it skips the "Do you trust this folder?" dialog
- Bypass approvals with `codex --dangerously-bypass-approvals-and-sandbox` via the `/home/viber/bin/codex` wrapper — codex's own sandbox is disabled because the container itself is the sandbox; `codex-default` is the escape hatch with normal approval prompts (it too skips codex's bubblewrap sandbox, which can't create the user namespaces it needs inside a container)
- Unpin `@musistudio/claude-code-router` in the CCR image (was `2.0.0`, which is still the latest today, so no version ever differed) — the weekly no-cache rebuild now picks up new CCR releases, matching the unpinned installs of every other provider CLI

## 3.6.0

- Bump all base images to **Ubuntu 26.04 LTS** ("Resolute Raccoon") across `docker/{claude,antigravity,ccr}.dockerfile` — the new LTS baseline with an up-to-date toolchain (glibc 2.43). Homebrew, `bun`, and the agent CLIs install unchanged; the built-in UID/GID 1000 user is still present, so the `viber` rename holds
- Install **bun** from its official installer into `~/.bun` (a normal image layer) instead of via Homebrew. bun is the container's PID 1 (`ENTRYPOINT ["bun", …]`), but Homebrew lives under the resettable `secure-vibe-brew` volume — so wiping or UID-mismatching that volume previously made bun vanish and the container fail to start. Decoupling bun from the volume keeps startup robust; Homebrew stays for `gcc` and user packages (adds `unzip` to the apt layer, required by the bun installer)
- **Heads-up:** Ubuntu 26.04 containers require a host booted with cgroup v2 (cgroup v1 support was removed upstream). Modern Docker / Docker Desktop default to v2, so most setups are unaffected

## 3.5.0

- Add **Claude Code Router** (`ccr`) as a selectable provider via `--ccr` (or `--claude-code-router`), alongside `--claude` and `--antigravity`: its own container image (`ghcr.io/loice5/secure-vibe/ccr`), Dockerfile, entrypoint, and `docker:build:ccr` / `docker:pull:ccr` / `prune:image:ccr` scripts. Routes Claude Code to alternative models (OpenRouter, GLM, DeepSeek, Gemini, or a local Ollama/LM Studio/MLX) while keeping the sandbox and bypass-permissions guarantees
- Install CCR with `bun` (no npm, no node) into `~/.bun`, with a `node`→`bun` shim
- **Every command routes through CCR** (a direct-to-Anthropic `claude` would defeat the container): `claude` and `ccr` run `ccr code` with `--dangerously-skip-permissions`; `claude-default` runs `ccr code` **without** bypass (normal permission prompts) for when you want to review actions. Each routing wrapper pins `CLAUDE_PATH` to an inner wrapper that calls the real `claude` binary by absolute path (no recursion) and appends the sandbox prompt — so all three carry the sandbox T&Cs, and nothing reaches Anthropic directly
- Launch straight into a session with no login or onboarding wizard: pre-accept Claude Code's first-run flags **and** give CCR a dummy `APIKEY` (only when the config sets none) that it forwards to Claude Code as its auth token, so Claude considers itself authenticated. No Claude.ai OAuth is injected (a real token could make Claude bypass CCR and hit Anthropic directly)
- Mount the host `~/.claude-code-router` **read-only** (mirrored writable in-container); when none exists, scaffold a starter `config.json` **on the host** (persistent and editable) defaulting to a free, tool-calling OpenRouter model (`qwen/qwen3-coder:free`) that runs with just `OPENROUTER_API_KEY`. `HOST` is always pinned to `127.0.0.1` so the router is never bound wide (the interactive Claude Code session is preserved — `NON_INTERACTIVE_MODE` is left untouched)
- Forward API keys with strict least privilege: parse `config.json` for `$VAR`/`${VAR}` references and forward **only** those, resolving each from the project `.env` first then the host env (`.env` wins) — variables the config doesn't reference are never forwarded
- Add `--local` (env `LOCAL`) for the CCR provider to reach host-machine models via `--add-host=host.docker.internal:host-gateway` — no published ports and no host-network mode

## 3.4.0

- Add the **Antigravity CLI** (`agy`) as a selectable provider via `--antigravity` (or the shorthand `--agy`), alongside the default `--claude`: its own container image (`ghcr.io/loice5/secure-vibe/antigravity`), Dockerfile, entrypoint, and `docker:build:antigravity` / `docker:pull:antigravity` scripts
- Start agy pre-authenticated: resolve the host token from the OS keyring (macOS Keychain / Linux Secret Service) with a `~/.gemini` token-file fallback, then forward it into the container so the session starts logged in
- Inject the sandbox system prompt into agy via `~/.gemini/GEMINI.md` (agy has no `--append-system-prompt` flag; the global context file is prepended to every prompt)
- Whitelist the workspace in agy's own trust store (`trustedWorkspaces` in `~/.gemini/antigravity-cli/settings.json`) so it skips the "Do you trust this folder?" dialog
- Re-assert the `/home/viber/bin` wrapper ahead of `~/.local/bin` on PATH (the agy installer prepends the latter in `.bashrc`), so `--dangerously-skip-permissions` reaches agy in interactive shells and it stops prompting for command approval

## 3.3.1

- Fix `claude-default` (the raw-binary escape hatch) being unavailable in the `--command` execution path (`bash -c` never sources `.bashrc`, so the alias didn't exist). It's now a real entry on PATH at `/home/viber/bin/claude-default` (a symlink to the raw binary), like the `claude` wrapper, so it works in non-interactive shells too

## 3.3.0

- Add dynamic shell tab-completion for the `secure-vibe` command (bash and zsh): completes flags, their values (`--save` → `zip`/`copy`/`no`, `--runtime` → `docker`/`podman`), and the directory positional. Install with `bun run setup:alias` (now wires up both the command and completion) or `bun run setup:completion`
- Completion is computed by the live binary on each `<TAB>` (a hidden `__complete` subcommand reading the same flag spec as the parser), so it stays current as flags evolve — no need to re-run setup after upgrading
- Install `secure-vibe` as a shell function instead of an alias so zsh routes completion correctly; the setup step migrates any existing alias automatically

## 3.2.0

- Name every container `secure-vibe-<provider>-<pid>` by default so it's easy to spot in `docker ps`; the pid suffix lets multiple secure-vibe instances run side by side without name clashes
- Skip the daily image pull when the local `latest` already matches the registry digest (compared via `docker buildx imagetools inspect`) instead of re-pulling on every check; podman and offline runs fall back to the previous pull behaviour
- Stop attaching the inline provenance/SBOM attestation that surfaced as an `unknown/unknown` platform in the published multi-arch manifest list
- Move the in-container `claude` wrapper and `.bashrc` auto-start snippet into `src/assets/*.sh` files copied in at build time, replacing the inline `printf` blocks

## 3.1.0

- Inject a sandbox system prompt into Claude on container start (via a `/home/viber/bin/claude` wrapper that adds `--dangerously-skip-permissions` and `--append-system-prompt`), so the flags apply in every execution path — interactive shell, auto-start, and `--command`
- Pin the container user to a fixed UID (`1000`) instead of deriving it from the host UID; the startup check warns when an existing `secure-vibe-brew` volume was seeded under a different UID. **Upgrade note:** if `brew` reports `Cellar is not writable`, run `docker volume rm secure-vibe-brew` once to reset it

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
