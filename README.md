# secure-vibe

Run an AI coding agent inside an isolated Docker or Podman container. Your credentials are injected automatically — no manual auth inside the container. Your host system stays untouched. *Bypass permissions* mode becomes reasonable.

Two providers are supported, selected with a flag:

- `--claude` *(default)* — [Claude Code](https://claude.ai/code)
- `--antigravity` — Google's [Antigravity CLI](https://antigravity.google) (`agy`), the successor to Gemini CLI (see [Providers](#providers))

The container comes with a persistent [Homebrew](https://brew.sh) volume (`secure-vibe-brew`) seeded on first run, so packages you install survive container restarts without being rebuilt into the image. You can therefore let the agent run your code without sudo access, fetching the needed dependencies on the fly. The volume is **shared by both providers** — it's a provider-neutral tooling cache (the agent CLIs themselves live in the image), so a Claude run and an Antigravity run use the same stack with no reinstall and no drift.

> **Upgrading from an older image?** The container user is now pinned to a fixed UID (`1000`); older images derived it from your host user. If `brew` reports `Cellar is not writable`, your brew volume was seeded under the old UID — reset it once with `docker volume rm secure-vibe-brew` (it re-seeds automatically on the next run).

> The underlying docker image is based on Ubuntu and is hardened. The user does not have root access. All packages are handled rootless via brew.

## Requirements

- [Bun](https://bun.sh)
- **Docker** or Podman (running)
- The provider you intend to use, authenticated on the host:
  - Claude: Claude Code installed and authenticated
  - Antigravity: see [Providers](#providers) for auth options

## Run

```sh
bun vibe                        # mount the current directory
bun vibe /path/to/project       # mount a specific directory
bun vibe . --save=zip           # zip the directory before starting
bun vibe . --runtime=podman     # force podman
bun vibe . --command=bash       # open a shell instead of the agent
bun vibe . --antigravity        # use Google's Antigravity CLI instead of Claude
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
| `--antigravity` | Use the Antigravity CLI (`agy`) provider (see [Providers](#providers)) |
| `--save=zip\|copy\|no` | Save the directory before starting: zip archive, directory copy, or skip |
| `--runtime=docker\|podman` | Container runtime to use |
| `--command=<cmd>` | Command to run inside the container (default: the selected provider's agent). Shell metacharacters supported. |
| `--build` | Rebuild the image before starting |
| `--build-no-cache` | Rebuild the image from scratch (no layer cache) |
| `--pull` | Force-pull the latest image before starting |
| `--exclude=<patterns>` | Comma-separated glob patterns of files to hide from the container (see [Excluding files](#excluding-files)) |

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
| `EXCLUDE` | Comma-separated glob patterns of files to hide from the container |
| `ANTIGRAVITY_API_KEY` | Google AI Studio API key, passed through to the Antigravity provider for non-interactive auth (see [Providers](#providers)) |

Copy `.env.example` to `.env` and set your defaults:

```sh
bun run env:init
```

## Config resolution

CLI args take priority over environment variables, which take priority over built-in defaults. There are no interactive prompts. When both docker and podman are available and no runtime is specified, docker is used (falling back to podman if docker isn't running); override with `RUNTIME` or `--runtime`.

## Providers

Pick a provider with `--claude` (default) or `--antigravity`. Each has its own image, brew volume, and credential handling. In both cases the host config is mounted **read-only** and nothing is written back to the host.

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

## Bun scripts

| Script | Description |
|---|---|
| `bun vibe` / `bun start` | Start the container |
| `bun run env:init` | Copy `.env.example` to `.env` (no-op if `.env` already exists) |
| `bun run setup:alias` | Install the `secure-vibe` shell alias **and** tab-completion (see [Shell completion](#shell-completion)) |
| `bun run setup:completion` | Install tab-completion only |
| `bun run build` | Compile a standalone binary for the current platform into `dist/secure-vibe` |
| `bun run build:arm64` | Compile for macOS arm64 (Apple Silicon) |
| `bun run build:x64` | Compile for macOS x64 (Intel) |
| `bun run prune:brew` | Delete the shared persistent Homebrew volume (both providers) |
| `bun run prune:agy` | Delete the Antigravity auth volumes (forces a fresh login) |
| `bun run prune:image:claude` | Remove the built Docker image for the Claude provider |
| `bun run prune:image:antigravity` | Remove the built Docker image for the Antigravity provider |
| `bun run docker:build:claude` / `docker:build:antigravity` | Build a provider image locally |

## Shell completion

```sh
bun run setup:alias        # installs the `secure-vibe` alias + tab-completion
exec $SHELL                # or: source ~/.bashrc / ~/.zshrc
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

> Note : The sibling directory isn't automatically deleted after the run. You can delete it manually after ensuring all files are properly back.

**Pattern syntax** — standard globs, comma-separated:

```sh
--exclude=".env"                        # exact filename (anywhere in tree)
--exclude=".env,.env.*"                 # multiple patterns
--exclude="secrets/**,**/*.pem"         # directories and wildcards
```

## Security notes

Mounting certain directories is blocked for safety: `~`, `/`, `/etc`, `/usr`, `/bin`, `/var`, and other system paths cannot be used as the working directory.
