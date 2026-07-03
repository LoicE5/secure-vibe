FROM ubuntu:26.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ── Root phase: system-level setup only ──────────────────────────────────────
# bubblewrap backs codex's own Linux sandbox — only exercised by codex-default
# (the main wrapper bypasses the sandbox; the container is the sandbox).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        build-essential \
        ca-certificates \
        unzip \
        bubblewrap \
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
    brew install gcc

# Install bun from its official installer into ~/.bun (a normal image layer, NOT the
# brew volume). bun is this container's PID 1 (ENTRYPOINT below) AND the build step that
# installs codex below runs through it, so it must never live under /home/linuxbrew, which
# the resettable secure-vibe-brew volume shadows at runtime.
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/viber/.bun/bin:${PATH}"

# Copy linuxbrew into the seed directory so the runtime volume can be populated
# on first run even though /home/linuxbrew will be shadowed by a named volume.
RUN cp -a /home/linuxbrew/. /opt/linuxbrew-seed/

# Install the Codex CLI with bun (no npm, no node). Lands in /home/viber/.bun —
# a normal image layer, NOT the shadowed brew volume, so there's no seed-ordering risk.
RUN bun install -g @openai/codex@0.142.5

COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md

# /home/viber/bin sits ahead of ~/.bun/bin so our wrapper shadows the real binary
# on PATH — covers interactive shell, auto-start, AND the explicit-command
# entrypoint path (which never sources .bashrc).
RUN mkdir -p /home/viber/bin
ENV PATH="/home/viber/bin:/home/viber/.bun/bin:${PATH}"

# node→bun shim: codex's bin script has a `#!/usr/bin/env node` shebang (it dispatches
# to the platform-native rust binary). The shim lets it — and the codex-default
# escape hatch — run without a real node.
RUN printf '#!/usr/bin/env bash\nexec bun "$@"\n' > /home/viber/bin/node \
    && chmod +x /home/viber/bin/node

# Fail fast at build time if the bun-installed bin doesn't resolve its
# platform-native binary (optional-dependency resolution differs per arch).
# Must come after the node shim (codex's bin script needs a `node` on PATH)
# and before the wrapper below shadows `codex`.
RUN codex --version

# Wrapper adds --dangerously-bypass-approvals-and-sandbox (the container is the sandbox).
COPY --chown=viber:viber src/assets/codex-wrapper.sh /home/viber/bin/codex
RUN chmod +x /home/viber/bin/codex

# Save the vanilla codex command into a symlink (escape hatch)
RUN ln -s /home/viber/.bun/bin/codex /home/viber/bin/codex-default

# Auto-start + PATH re-assertion appended to .bashrc. The SHLVL guard ensures
# auto-start fires only on the outermost bash, not on sub-shells.
COPY --chown=viber:viber src/assets/codex-bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/codex.ts /home/viber/entrypoint.ts

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]
