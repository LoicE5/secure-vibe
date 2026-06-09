# secure-vibe

Run an AI coding agent inside an isolated Docker or Podman container. Your credentials are injected automatically — no manual auth inside the container. Your host system stays untouched. *Bypass permissions* mode becomes reasonable.

Three providers are supported, selected with a flag:

- `--claude` *(default)* — [Claude Code](https://claude.ai/code)
- `--antigravity` (alias `--agy`) — Google's [Antigravity CLI](https://antigravity.google) (`agy`), the successor to Gemini CLI (see [Providers](#providers))
- `--ccr` (alias `--claude-code-router`) — [Claude Code Router](https://github.com/musistudio/claude-code-router): run Claude Code against other models — OpenRouter, GLM, DeepSeek, or a local Ollama/LM Studio (see [Providers](#providers))

Why it's safe:

- The agent runs in an isolated container; your host filesystem is untouched apart from the one directory you mount.
- Host credentials and config are mounted **read-only** and injected into the container's own copies — nothing is ever written back to the host.
- The image is hardened Ubuntu **26.04 LTS**: root is locked, the container user is a fixed non-root UID (`1000`), and no ports are published.

**Current version: 3.6.0** — see the [CHANGELOG](CHANGELOG.md).

## Contents

- [Persistent Homebrew volume](#persistent-homebrew-volume)
- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [Run](#run)
- [CLI Parameters](#cli-parameters)
- [Images](#images)
- [Environment Variables](#environment-variables)
- [Config resolution](#config-resolution)
- [Providers](#providers)
- [Bun scripts](#bun-scripts)
- [Shell completion](#shell-completion)
- [Excluding files](#excluding-files)
- [Security notes](#security-notes)

## Persistent Homebrew volume

The container ships with a persistent [Homebrew](https://brew.sh) volume (`secure-vibe-brew`), seeded on first run. Packages you install survive container restarts without being rebuilt into the image, so the agent can fetch dependencies on the fly with no sudo access. The volume is **shared by all providers** — it's a provider-neutral tooling cache (the agent CLIs and `bun` are baked into the image as layers; brew handles your *user* packages, rootless), so a Claude run and an Antigravity run use the same stack with no reinstall and no drift.

> **Upgrading from an older image?** The container user is now pinned to a fixed UID (`1000`); older images derived it from your host user. If `brew` reports `Cellar is not writable`, your brew volume was seeded under the old UID — reset it once with `docker volume rm secure-vibe-brew` (it re-seeds automatically on the next run).

## Requirements

- [Bun](https://bun.sh)
- **Docker** or Podman (running), on a host booted with cgroup v2 (Ubuntu 26.04 containers no longer support cgroup v1; modern Docker / Docker Desktop default to v2, so most setups are unaffected)
- The provider you intend to use, authenticated on the host:
  - Claude: Claude Code installed and authenticated
  - Antigravity: see [Providers](#providers) for auth options
  - CCR: no host auth needed — just a `~/.claude-code-router/config.json` (scaffolded on first run) and the API key(s) it references, e.g. `OPENROUTER_API_KEY` in your project `.env` (see [Providers](#providers))

## Quickstart

```sh
git clone https://github.com/LoicE5/secure-vibe.git
cd secure-vibe
bun vibe /path/to/project        # start the agent on your project
bun run setup:alias              # optional: install the `secure-vibe` alias + tab-completion
```

Prefer a standalone binary? `bun run build` compiles one per platform into `dist/` (see [Bun scripts](#bun-scripts)).

## Run

```sh
bun vibe                        # mount the current directory
bun vibe /path/to/project       # mount a specific directory
bun vibe . --save=zip           # zip the directory before starting
bun vibe . --runtime=podman     # force podman
bun vibe . --command=bash       # open a shell instead of the agent
bun vibe . --antigravity        # use Google's Antigravity CLI instead of Claude
bun vibe . --ccr                # route Claude Code to other models via Claude Code Router
bun vibe . --build              # rebuild the image before starting
bun vibe . --build-no-cache     # rebuild without cache
bun vibe . --pull               # force-pull the latest image before starting
bun vibe . --exclude=.env       # hide .env from the container
bun vibe . --exclude=".env,.env.*,secrets/**"  # multiple glob patterns
```

## CLI Parameters

| Parameter | Description |
|---|---|
| `[directory]` | Path to mount into the container (positional, defaults to current directory) |
| `--claude` | Use the Claude Code provider (default) |
| `--antigravity`, `--agy` | Use the Antigravity CLI (`agy`) provider (see [Providers](#providers)) |
| `--ccr`, `--claude-code-router` | Use the Claude Code Router (`ccr`) provider — route Claude Code to other models (see [Providers](#providers)) |
| `--local` | (ccr only) Allow the container to reach models running on the host machine (adds a host-gateway DNS entry; no ports, no host network) |
| `--save=zip\|copy\|no` | Save the directory before starting: zip archive, directory copy, or skip |
| `--runtime=docker\|podman` | Container runtime to use |
| `--command=<cmd>` | Command to run inside the container (default: the selected provider's agent). Shell metacharacters supported. |
| `--build` | Rebuild the image before starting |
| `--build-no-cache` | Rebuild the image from scratch (no layer cache) |
| `--pull` | Force-pull the latest image before starting |
| `--exclude=<patterns>` | Comma-separated glob patterns of files to hide from the container (see [Excluding files](#excluding-files)) |

## Images

Each provider has its own image, published to GHCR as `ghcr.io/loice5/secure-vibe/<provider>:latest` (`claude`, `antigravity`, `ccr`). With no flags, secure-vibe uses the local image if present (checking the registry for updates at most once a day), pulls it if missing, and falls back to building locally from `docker/<provider>.dockerfile` if the pull fails. Use `--pull` to force-pull, or `--build` / `--build-no-cache` to force a local build.

## Environment Variables

secure-vibe never prompts. Any variable left unset (or set to `"prompt"`) falls back to its default: current directory, `save=no`, and `docker` when both runtimes are available.

| Variable | Description |
|---|---|
| `DIRECTORY` | Directory to mount (e.g. `.` or `/path/to/project`) |
| `RUNTIME` | Container runtime: `docker` or `podman` |
| `SAVE` | Save mode before starting: `zip`, `copy`, or `no` |
| `COMMAND` | Command to run inside the container |
| `BUILD` | Force image rebuild: `true`, `1`, or `yes` |
| `BUILD_NO_CACHE` | Force rebuild without cache: `true`, `1`, or `yes` |
| `PULL` | Force-pull the latest image: `true`, `1`, or `yes` |
| `LOCAL` | (ccr only) Allow the container to reach host-machine models: `true`, `1`, or `yes`. Equivalent to `--local` |
| `EXCLUDE` | Comma-separated glob patterns of files to hide from the container |
| `ANTIGRAVITY_API_KEY` | Google AI Studio API key, passed through to the Antigravity provider for non-interactive auth (see [Providers](#providers)) |

Copy `.env.example` to `.env` and set your defaults:

```sh
bun run env:init
```

## Config resolution

CLI args take priority over environment variables, which take priority over built-in defaults. There are no interactive prompts. When both docker and podman are available and no runtime is specified, docker is used (falling back to podman if docker isn't running); override with `RUNTIME` or `--runtime`.

## Providers

Pick a provider with `--claude` (default), `--antigravity` (alias `--agy`), or `--ccr` (alias `--claude-code-router`). Each has its own image and credential handling; the [brew volume](#persistent-homebrew-volume) is shared. In every case the host config is mounted **read-only** and nothing is written back to the host.

### Claude (default)

Credentials are resolved automatically in this order:

1. `~/.claude.json` (Claude Code 2.1.63+)
2. macOS Keychain entry `Claude Code-credentials` (macOS only)
3. `~/.claude/.credentials.json` (legacy fallback)

The host `~/.claude` directory is mounted **read-only**. Credentials are injected into the container via an environment variable and written to the container's own `~/.claude` — nothing is ever written back to the host.

### Antigravity (`agy`)

Log in once on the host (`agy`, complete Google sign-in) — secure-vibe handles the rest, same as Claude. `agy` keeps its OAuth token in the OS keyring; inside a container it detects `/.dockerenv` and reads the token from a file instead. secure-vibe reads your host token, decodes it, and writes it to the container's token file, so `agy` starts already logged in. Resolution order:

1. **`ANTIGRAVITY_API_KEY`** env var (a Google AI Studio key) — non-interactive alternative.
2. **OS keyring** (go-keyring service `gemini`, account `antigravity`):
   - **macOS** — Keychain via `security`.
   - **Linux desktop** — Secret Service (gnome-keyring/KWallet) via `secret-tool` (needs `libsecret-tools` on the host).
3. **Token file** `~/.gemini/antigravity-cli/antigravity-oauth-token` — used by **headless Linux** (where `agy` itself falls back to file storage) or a manual drop-in.

The token is injected via env and written to the container's `~/.gemini/antigravity-cli/antigravity-oauth-token` (go-keyring base64-decoded to the raw JSON `agy` expects); `~/.gemini` is mounted **read-only** for settings. Nothing is written back to the host.

Antigravity has no `--append-system-prompt` flag, so the sandbox system prompt is injected via the container's global `~/.gemini/GEMINI.md` context file (in a marker-guarded block). Permissions are bypassed with `agy --dangerously-skip-permissions`; the container itself is the sandbox.

### Claude Code Router (`ccr`)

[Claude Code Router](https://github.com/musistudio/claude-code-router) (CCR, MIT) runs Claude Code against alternative models — GLM, OpenRouter, DeepSeek, Gemini, or a local Ollama/LM Studio. CCR runs a small HTTP server **inside** the container on `127.0.0.1:3456`, points Claude Code at it (`ANTHROPIC_BASE_URL`), and routes each request to the model your config names. Because the server and Claude Code share the one container, cloud routing needs **no published ports and no host-network mode** — ordinary outbound bridge networking is enough.

- **Config — mount or scaffold.** Your host `~/.claude-code-router` is mounted **read-only** and mirrored into a writable copy inside the container. If you have no config yet, secure-vibe writes a starter `config.json` on the host (see the [examples below](#example-claude-code-routerconfigjson)) — it defaults to a free, tool-calling OpenRouter model, so it runs with just `OPENROUTER_API_KEY` in your project `.env`. Edit it and re-run. `HOST` is always pinned to `127.0.0.1` in the container so the router is never bound wide (and the container publishes no ports regardless).
- **API keys — referenced-only forwarding.** CCR resolves keys via `$VAR`/`${VAR}` references in `config.json`; it does not read `.env` itself. secure-vibe parses your config, and forwards **only the variables it actually references**, resolving each from your project `.env` first, then your shell env (`.env` wins). A variable your config doesn't reference is never forwarded — least privilege by default. Unresolved references are warned about (CCR substitutes empty).
- **Host-machine models — `--local`.** To reach a model running on your host (e.g. `ollama serve` on `11434`), add `--local`. It adds only `--add-host=host.docker.internal:host-gateway` (a DNS entry to the host gateway) — **not** host networking, and **no** inbound ports. Your config then uses `http://host.docker.internal:11434`.
- **Every command routes through CCR.** A direct-to-Anthropic `claude` would defeat the point of this container, so all three entry points go through `ccr code`; they differ only in permission posture:

  | Command | Routes via | Permissions | Sandbox prompt |
  |---|---|---|---|
  | `claude` | `ccr code` | `--dangerously-skip-permissions` | yes |
  | `ccr` | `ccr code` | `--dangerously-skip-permissions` | yes |
  | `claude-default` | `ccr code` | normal prompts (no bypass) | yes |

  Each routing wrapper pins `CLAUDE_PATH` to an inner wrapper that calls the real `claude` binary by absolute path (no recursion). Use `claude` or `ccr` for the usual bypass workflow; use `claude-default` when you want to review each action. Nothing reaches Anthropic directly. The container itself is the sandbox.
- **No Anthropic account needed.** Claude Code's first-run flags (onboarding, folder-trust, bypass) are pre-accepted, and secure-vibe gives CCR a dummy `APIKEY` (only when your config sets none) that CCR forwards to Claude Code as its auth token — so Claude considers itself authenticated and launches straight into a session with no login or wizard. secure-vibe deliberately does **not** inject your Claude.ai subscription here: a real OAuth token can make Claude Code talk to Anthropic directly and bypass CCR's routing.

> **Note:** Routing Claude Code to non-Anthropic models is a grey area under Anthropic's Claude Code terms. That's a choice you make as the operator (identical to running CCR on your own machine); it isn't something the secure-vibe project does on your behalf.

#### Selecting a model

A model is named `provider,model_id` (the `provider` is a `Providers[].name`; the `model_id` is one of that provider's `models`). Two ways to pick one:

- **In the config** — set `Router.default` (the main session model). Other slots: `background` (Claude Code's lightweight calls), `think`, `longContext`, `webSearch`. Each takes the same `provider,model_id` string.
- **At runtime** — switch the active model any time from inside Claude Code with `/model openrouter,qwen/qwen3-coder:free` (or any `provider,model_id` your config defines).

The scaffolded starter defaults to **`openrouter,qwen/qwen3-coder:free`** — a free, tool-calling coding model that runs with just an `OPENROUTER_API_KEY`. `openrouter/free` (an auto-router over free tool-capable models) is also listed to switch to.

> **Free-model caveats.** Free tiers are rate-limited and noticeably rougher at Claude Code's tool-heavy, long-context workflows than frontier models — fine for trying things out, weak for real agentic work. Some free endpoints also have hard constraints: `openai/gpt-oss-120b:free`, for example, **mandates reasoning** and returns `400 "Reasoning is mandatory for this endpoint and cannot be disabled"` because CCR disables reasoning for agentic use. secure-vibe uses CCR's behavior as-is and doesn't re-engineer its request handling — so pick a model that works out of the box (like `qwen/qwen3-coder:free`) or point `Router.default` at a paid frontier model for serious work.

#### Example `~/.claude-code-router/config.json`

A single config can mix providers. This one has both a **cloud provider** (OpenRouter) and a **host-machine model** (MLX/Ollama/LM Studio/llama.cpp — any OpenAI-compatible local server). The `Router` sends the main session to OpenRouter and Claude Code's lightweight background calls to the local model; switch the active model any time from inside Claude Code with `/model openrouter,anthropic/claude-sonnet-4` or `/model mlx,mlx-community/Qwen2.5-7B-Instruct-4bit`.

```json
{
  "HOST": "127.0.0.1",
  "PORT": 3456,
  "Providers": [
    {
      "name": "openrouter",
      "api_base_url": "https://openrouter.ai/api/v1/chat/completions",
      "api_key": "$OPENROUTER_API_KEY",
      "models": ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro-preview"],
      "transformer": { "use": ["openrouter"] }
    },
    {
      "name": "mlx",
      "api_base_url": "http://host.docker.internal:8080/v1/chat/completions",
      "api_key": "not-needed",
      "models": ["mlx-community/Qwen2.5-7B-Instruct-4bit"]
    }
  ],
  "Router": {
    "default": "openrouter,anthropic/claude-sonnet-4",
    "background": "mlx,mlx-community/Qwen2.5-7B-Instruct-4bit"
  }
}
```

Notes on the two providers:

- **OpenRouter (cloud):** needs the `openrouter` transformer. Reference the key as `$OPENROUTER_API_KEY` and set it in your project `.env` — secure-vibe forwards only that referenced variable into the container.
- **MLX (host):** any OpenAI-compatible local server, no transformer. Reach the host via `host.docker.internal` (the example assumes `mlx_lm.server --model mlx-community/Qwen2.5-7B-Instruct-4bit` on port 8080).

```sh
# .env  (in the directory you run secure-vibe from)
OPENROUTER_API_KEY=sk-or-...
```
```sh
# --local is required so the container can reach the host MLX server
secure-vibe --ccr --local
```

> If you get *connection refused* reaching a host server bound to `127.0.0.1`, restart it on all interfaces (e.g. `mlx_lm.server --host 0.0.0.0 …`, `OLLAMA_HOST=0.0.0.0 ollama serve`). Small local models (7B/quantized) work for trying things out but are much weaker at Claude Code's tool-heavy, long-context workflows than frontier models. If you only use the cloud provider, drop the `mlx` block and the `background` route and run without `--local`.

## Bun scripts

| Script | Description |
|---|---|
| `bun vibe` / `bun start` | Start the container |
| `bun run env:init` | Copy `.env.example` to `.env` (no-op if `.env` already exists) |
| `bun run setup:alias` | Install the `secure-vibe` shell alias **and** tab-completion (see [Shell completion](#shell-completion)) |
| `bun run setup:completion` | Install tab-completion only |
| `bun run build` | Compile standalone binaries for all supported platforms into `dist/secure-vibe-<target>` |
| `bun run build:linux-x64` / `build:linux-arm64` / `build:macos-x64` / `build:macos-arm64` | Compile for a single platform |
| `bun run prune:brew` | Delete the shared persistent Homebrew volume (all providers) |
| `bun run prune:image:claude` | Remove the built Docker image for the Claude provider |
| `bun run prune:image:antigravity` | Remove the built Docker image for the Antigravity provider |
| `bun run prune:image:ccr` | Remove the built Docker image for the CCR provider |
| `bun run docker:build:claude` / `docker:build:antigravity` / `docker:build:ccr` | Build a provider image locally (append `:no-cache` to any of them to skip the layer cache) |
| `bun run docker:pull:claude` / `docker:pull:antigravity` / `docker:pull:ccr` | Pull a provider image from GHCR |

## Shell completion

```sh
bun run setup:alias        # installs the `secure-vibe` alias + tab-completion
exec $SHELL                # or: source ~/.bash_aliases / ~/.zsh_aliases (where the stubs are installed)
```

After setup, press `<TAB>` to complete flags, their values, and the directory:

```sh
secure-vibe <TAB>             # flags + directory names
secure-vibe --<TAB>           # --save --runtime --command --exclude --build …
secure-vibe --runtime <TAB>   # docker  podman
secure-vibe --save=<TAB>      # zip  copy  no
```

Completion is **dynamic**: the installed shell stub asks the live `secure-vibe` for its
suggestions on each `<TAB>`, so it **stays current automatically** as the tool gains flags —
you never need to re-run setup after upgrading. Supports bash and zsh.

## Excluding files

Use `--exclude` (or the `EXCLUDE` env var) to prevent specific files from being visible inside the container — useful for API keys, `.env` files, or any secrets you don't want Claude to access.

**How it works:**

1. Patterns are resolved as globs against the mounted directory (dotfiles included).
2. Before the container starts, all matching files are **moved** out of the project directory into a sibling folder named `<project>-<timestamp>-secrets/`. A `manifest.json` is written there to track original paths.
3. The container runs with those files absent from the filesystem — they cannot be read, logged, or leaked.
4. After the container exits (regardless of exit code), every file is **moved back** to its original location.

The move-out step happens after image build, so a pre-flight failure never leaves files displaced.

> Note: The sibling directory isn't automatically deleted after the run. You can delete it manually after ensuring all files are properly back.

**Pattern syntax** — standard globs, comma-separated:

```sh
--exclude=".env"                        # exact filename (anywhere in tree)
--exclude=".env,.env.*"                 # multiple patterns
--exclude="secrets/**,**/*.pem"         # directories and wildcards
--exclude="secrets"                     # a bare name that is a directory excludes it whole
```

If an excluded file is **not** gitignored, a warning is printed — the move is visible to git, so anything tracked will show up as deleted in `git status` for the duration of the run.

## Security notes

- **Blocked mounts.** System paths cannot be used as the working directory: `~`, `/`, `/etc`, `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/var`, `/tmp`, `/proc`, `/sys`, `/dev`, and `/boot` are all rejected.
- **Read-only host config.** Provider config directories (`~/.claude`, `~/.gemini`, `~/.claude-code-router`) are mounted read-only; credentials are injected into the container's own copies and nothing is written back to the host.
- **Hardened image.** Root is locked, the container user is a fixed non-root UID (`1000`), and no ports are published. The agent CLIs and `bun` are image layers; user packages are installed rootless via brew.
- **Git identity.** Your host `user.name` / `user.email` are forwarded into the container (via `GIT_USER_NAME` / `GIT_USER_EMAIL`) so commits made inside are attributed to you; if none is configured, it falls back to `Claude <noreply@anthropic.com>`.
