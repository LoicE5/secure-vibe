# secure-vibe

## What is this project about?

secure-vibe runs AI coding agents in disposable Docker or Podman containers. It lets agents install tools and work with permission prompts bypassed, while keeping their environment separate from your host system. Your selected project directory is mounted read-write, so edits land directly in your files.

It handles container setup, reuses your existing provider login, and keeps installed development tools between sessions. It supports Claude Code, OpenAI Codex, Google Antigravity, Mistral Vibe, and Claude Code Router for alternative models.

## How to use

1. **Install the prerequisites.**

   - [Bun](https://bun.sh) and a running Docker or Podman installation.
   - Log in to your chosen agent on the host first: Claude Code, `codex login`, `agy`, or `vibe`.
   - For Claude Code Router (`--ccr`), supply `OPENROUTER_API_KEY` in your shell or project's `.env`; a starter config is created on first run. No Anthropic login is needed.

2. **Clone and launch.** Claude Code is the default; add a provider flag to switch.

   ```sh
   git clone https://github.com/LoicE5/secure-vibe.git
   cd secure-vibe
   bun vibe /path/to/project
   ```

   > The agent can modify or delete files in the mounted project. Add `--save=zip` or `--save=copy` to back it up before starting; backups are off by default.

3. **Optionally install the shell command** and bash/zsh tab completion:

   ```sh
   bun run setup:alias
   ```

   Restart your shell, then run `secure-vibe` from any project directory. Keep the cloned repository: the command uses it.

4. **Choose the options you need.** These work with both `bun vibe` and `secure-vibe`.

   - **Agent:** `--claude` (default), `--codex`, `--antigravity`, `--vibe`, or `--ccr`.
   - **Files:** `--save=zip` for a backup; `--exclude=".env,.env.*,secrets/**"` to hide matching files.
   - **Environment:** `--runtime=podman` to select Podman; `--command=bash` to open a shell.
   - **Docker:** `--dind` for a nested Docker daemon, Compose, and Buildx (see Notes).
   - **Images:** `--pull` to refresh; `--build` or `--build-no-cache` to build locally.

   ```sh
   secure-vibe . --codex --save=zip --exclude=".env,.env.*"
   secure-vibe /path/to/project --claude --dind
   ```

For persistent defaults, copy [`.env.example`](.env.example) to `.env` in the secure-vibe repository and set the `SECURE_VIBE_*` variables. Flags override exported variables, then repository defaults. See [`package.json`](package.json) for build and maintenance commands.

## Notes

- **Rootless tooling.** The Ubuntu-based image runs the agent as `viber` (UID 1000), with root login locked and no sudo. Homebrew is copied from its official image and lets the agent install packages as that user. This does not require the host's Docker daemon to be rootless.

- **Persistence.** Homebrew packages live in `secure-vibe-brew`, shared by all providers and seeded on first use. Agent CLIs and Bun belong to the image. Containers are removed on exit; project edits and named volumes remain. Provider state lives in disposable container copies.

- **Credentials and config.** Host provider settings are mounted read-only and copied into the container; credentials are injected into its own environment or files. Session changes are not written back to host settings. The agent still has access to the credentials it needs and to outbound networking.

- **Docker-in-Docker.** `--dind` starts a separate rootless Docker daemon using RootlessKit and subordinate UID/GID mappings, without mounting the host Docker socket. Images persist in `secure-vibe-docker`; simultaneous sessions use a temporary data root when it is busy. The outer container runs with **`--privileged`**, disabling its usual seccomp/AppArmor confinement: isolation is weaker even though the agent stays non-root. This mode is only tested with Docker, and nested published ports are reachable only inside the sandbox.

- **Excluded files.** `--exclude` temporarily moves matches into a sibling `<project>-<timestamp>-secrets/` directory and restores them after the session. Tracked files appear deleted while excluded. The sibling folder and recovery manifest remain afterward.

- **Alternative models.** `--ccr` runs Claude Code Router inside the container using `~/.claude-code-router/config.json`. Only environment variables referenced by that config are forwarded, with the project's `.env` taking priority. Add `--local` and use `http://host.docker.internal:<port>` to reach a model server on your host; it must listen on an address reachable from the container.
