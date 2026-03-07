# secure-vibe

Run Claude Code inside an isolated Docker or Podman container. Your credentials are injected automatically — no manual auth inside the container. Your host system stays untouched. *Bypass permissions* mode becomes reasonable.

The container comes with a persistent [Homebrew](https://brew.sh) volume (`secure-vibe-brew`) seeded on first run, so packages you install survive container restarts without being rebuilt into the image. You can therefore let claude run your code without sudo access, fetching the needed dependencies on the fly.

> The underlying docker image is based on Ubuntu and is hardened. The user does not have root access. All packages are handled rootless via brew.

## Requirements

- [Bun](https://bun.sh)
- **Docker** or Podman (running)
- Claude Code installed and authenticated on the host

## Run

```sh
bun vibe                        # prompts for directory
bun vibe /path/to/project       # mount a specific directory
bun vibe . --save=zip           # zip the directory before starting
bun vibe . --runtime=podman     # force podman
bun vibe . --command=bash       # open a shell instead of Claude
bun vibe . --build              # rebuild the image before starting
bun vibe . --build-no-cache     # rebuild without cache
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

## Environment Variables

All variables accept `"prompt"` as a value to force an interactive prompt even when set.

| Variable | Description |
|---|---|
| `DIRECTORY` | Directory to mount (e.g. `.` or `/path/to/project`) |
| `RUNTIME` | Container runtime: `docker` or `podman` |
| `SAVE` | Save mode before starting: `zip`, `copy`, or `no` |
| `COMMAND` | Command to run inside the container |
| `BUILD` | Force image rebuild: `true`, `1`, or `yes` |
| `BUILD_NO_CACHE` | Force rebuild without cache: `true`, `1`, or `yes` |

Copy `.env.example` to `.env` and set your defaults:

```sh
cp .env.example .env
```

## Config resolution

CLI args take priority over environment variables, which take priority over interactive prompts.

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
| `bun run prune:brew` | Delete the persistent Homebrew volume |
| `bun run prune:image` | Remove the built Docker image |

## Security notes

Mounting certain directories is blocked for safety: `~`, `/`, `/etc`, `/usr`, `/bin`, `/var`, and other system paths cannot be used as the working directory.
