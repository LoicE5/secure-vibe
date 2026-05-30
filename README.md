# secure-vibe

Run Claude Code inside an isolated Docker or Podman container. Your credentials are injected automatically — no manual auth inside the container. Your host system stays untouched. *Bypass permissions* mode becomes reasonable.

The container comes with a persistent [Homebrew](https://brew.sh) volume (`secure-vibe-brew`) seeded on first run, so packages you install survive container restarts without being rebuilt into the image. You can therefore let claude run your code without sudo access, fetching the needed dependencies on the fly.

> **Upgrading from an older image?** The container user is now pinned to a fixed UID (`1000`); older images derived it from your host user. If `brew` reports `Cellar is not writable`, your brew volume was seeded under the old UID — reset it once with `docker volume rm secure-vibe-brew` (it re-seeds automatically on the next run).

> The underlying docker image is based on Ubuntu and is hardened. The user does not have root access. All packages are handled rootless via brew.

## Requirements

- [Bun](https://bun.sh)
- **Docker** or Podman (running)
- Claude Code installed and authenticated on the host

## Run

```sh
bun vibe                        # mount the current directory
bun vibe /path/to/project       # mount a specific directory
bun vibe . --save=zip           # zip the directory before starting
bun vibe . --runtime=podman     # force podman
bun vibe . --command=bash       # open a shell instead of Claude
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
| `--save=zip\|copy\|no` | Save the directory before starting: zip archive, directory copy, or skip |
| `--runtime=docker\|podman` | Container runtime to use |
| `--command=<cmd>` | Command to run inside the container (default: Claude Code). Shell metacharacters supported. |
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

Copy `.env.example` to `.env` and set your defaults:

```sh
bun run env:init
```

## Config resolution

CLI args take priority over environment variables, which take priority over built-in defaults. There are no interactive prompts. When both docker and podman are available and no runtime is specified, docker is used (falling back to podman if docker isn't running); override with `RUNTIME` or `--runtime`.

## Credentials

Credentials are resolved automatically in this order:

1. `~/.claude.json` (Claude Code 2.1.63+)
2. macOS Keychain entry `Claude Code-credentials` (macOS only)
3. `~/.claude/.credentials.json` (legacy fallback)

The host `~/.claude` directory is mounted **read-only**. Credentials are injected into the container via an environment variable and written to the container's own `~/.claude` — nothing is ever written back to the host.

## Bun scripts

| Script | Description |
|---|---|
| `bun vibe` / `bun start` | Start the container |
| `bun run env:init` | Copy `.env.example` to `.env` (no-op if `.env` already exists) |
| `bun run build` | Compile a standalone binary for the current platform into `dist/secure-vibe` |
| `bun run build:arm64` | Compile for macOS arm64 (Apple Silicon) |
| `bun run build:x64` | Compile for macOS x64 (Intel) |
| `bun run prune:brew` | Delete the persistent Homebrew volume |
| `bun run prune:image:claude` | Remove the built Docker image for the Claude provider |

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
