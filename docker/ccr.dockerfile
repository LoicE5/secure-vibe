FROM ubuntu:24.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ── Root phase: system-level setup only ──────────────────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        build-essential \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Rename the built-in ubuntu user/group (UID/GID 1000) to viber and move its home.
RUN usermod -l viber -d /home/viber -m ubuntu \
    && groupmod -n viber ubuntu

# Pre-create the Homebrew prefix directory and hand it to viber
# (the install script targets /home/linuxbrew/.linuxbrew on Linux)
RUN mkdir -p /home/linuxbrew && chown viber:viber /home/linuxbrew

# Seed directory: populated after brew installs so the runtime volume can be
# initialized on first run without requiring root inside the container.
RUN mkdir -p /opt/linuxbrew-seed && chown viber:viber /opt/linuxbrew-seed

# Lock root: remove login shell and lock the password before dropping privileges
RUN passwd -l root && usermod -s /usr/sbin/nologin root

# ── Drop to non-root — root is no longer reachable from this point ───────────
USER viber
WORKDIR /home/viber/app

# Install Homebrew as viber (non-root, installs to /home/linuxbrew/.linuxbrew)
RUN curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash

# Expose brew on PATH for all subsequent layers and the running container
ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"

RUN brew update && \
    brew tap oven-sh/bun && \
    brew install gcc bun

# Copy linuxbrew into the seed directory so the runtime volume can be populated
# on first run even though /home/linuxbrew will be shadowed by a named volume.
RUN cp -a /home/linuxbrew/. /opt/linuxbrew-seed/

# Install the native Claude CLI (claude.ai/install.sh → ~/.local/bin). `ccr code`
# launches it; our wrapper below adds the bypass flags + sandbox prompt.
RUN curl -fsSL https://claude.ai/install.sh | bash

# Install claude-code-router with bun (no npm, no node). Lands in /home/viber/.bun —
# a normal image layer, NOT the shadowed brew volume, so there's no seed-ordering risk.
RUN bun install -g @musistudio/claude-code-router@2.0.0

COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md

# /home/viber/bin sits ahead of ~/.local/bin and ~/.bun/bin so our wrappers shadow the
# real binaries on PATH — covers interactive shell, auto-start, AND the explicit-command
# entrypoint path (which never sources .bashrc).
RUN mkdir -p /home/viber/bin
ENV PATH="/home/viber/bin:/home/viber/.local/bin:/home/viber/.bun/bin:${PATH}"

# node→bun shim: CCR's `ccr` bin has a `#!/usr/bin/env node` shebang. We launch it via
# `bun --bun` (the wrapper) which already aliases node→bun, but this shim covers any
# `node` invocation CCR makes internally, so a real node is never needed.
RUN printf '#!/usr/bin/env bash\nexec bun "$@"\n' > /home/viber/bin/node \
    && chmod +x /home/viber/bin/node

# claude wrapper: `ccr code` spawns `claude` and inherits --dangerously-skip-permissions
# + the sandbox prompt (the point of secure-vibe). CCR resolves the binary from
# CLAUDE_PATH (then $PATH, then "claude"), so pin it to the wrapper explicitly — this
# guarantees the bypass wrapper is used regardless of PATH ordering inside CCR's shell.
COPY --chown=viber:viber src/assets/claude-wrapper.sh /home/viber/bin/claude
RUN chmod +x /home/viber/bin/claude
ENV CLAUDE_PATH="/home/viber/bin/claude"

# ccr wrapper: routes `ccr` → `ccr code` via bun, calling the real ccr by absolute path.
COPY --chown=viber:viber src/assets/ccr-wrapper.sh /home/viber/bin/ccr
RUN chmod +x /home/viber/bin/ccr

# Escape-hatch symlinks to the vanilla binaries.
RUN ln -s /home/viber/.local/bin/claude /home/viber/bin/claude-default \
    && ln -s /home/viber/.bun/bin/ccr /home/viber/bin/ccr-default

# Auto-start + PATH re-assertion appended to .bashrc. The SHLVL guard ensures
# auto-start fires only on the outermost bash, not on sub-shells.
COPY --chown=viber:viber src/assets/ccr-bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/ccr.ts /home/viber/entrypoint.ts

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]
