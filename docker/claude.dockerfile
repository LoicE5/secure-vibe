FROM ubuntu:26.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ── Root phase: system-level setup only ──────────────────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        build-essential \
        ca-certificates \
        unzip \
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
# brew volume). bun is this container's PID 1 (ENTRYPOINT below), so it must never live
# under /home/linuxbrew, which the resettable secure-vibe-brew volume shadows at runtime.
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/viber/.bun/bin:${PATH}"

# Copy linuxbrew into the seed directory so the runtime volume can be populated
# on first run even though /home/linuxbrew will be shadowed by a named volume.
RUN cp -a /home/linuxbrew/. /opt/linuxbrew-seed/

RUN curl -fsSL https://claude.ai/install.sh | bash

COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md

# /home/viber/bin sits ahead of ~/.local/bin so the wrapper below shadows the
# real claude binary on PATH — covers interactive shell, auto-start, AND the
# explicit-command entrypoint path (which never sources .bashrc).
RUN mkdir -p /home/viber/bin
ENV PATH="/home/viber/bin:/home/viber/.local/bin:${PATH}"

COPY --chown=viber:viber src/assets/claude-wrapper.sh /home/viber/bin/claude
RUN chmod +x /home/viber/bin/claude

# Save the vanilla claude command into a symlink
RUN ln -s /home/viber/.local/bin/claude /home/viber/bin/claude-default

# Auto-start + escape hatch appended to .bashrc. `claude` resolves through PATH
# to the wrapper above; no alias needed. The SHLVL guard ensures auto-start
# fires only on the outermost bash, not on sub-shells.
COPY --chown=viber:viber src/assets/bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/claude.ts /home/viber/entrypoint.ts

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]