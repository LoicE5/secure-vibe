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

# Rename the built-in ubuntu user/group (UID/GID 1000) to viber and move its home
RUN usermod -l viber -d /home/viber -m ubuntu \
    && groupmod -n viber ubuntu

# Match the host user's UID/GID so mounted volume files are accessible
ARG UID=1000
ARG GID=1000
RUN usermod -u $UID viber && groupmod -o -g $GID viber

# Pre-create the Homebrew prefix directory and hand it to viber
# (the install script targets /home/linuxbrew/.linuxbrew on Linux)
RUN mkdir -p /home/linuxbrew && chown viber:viber /home/linuxbrew

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

RUN curl -fsSL https://claude.ai/install.sh | bash

ENV PATH="/home/viber/.local/bin:${PATH}"

# Auto-start claude when the user enters the container shell.
# SHLVL guard ensures it only fires on the outermost bash, not on sub-shells.
RUN cat >> /home/viber/.bashrc <<'EOF'

# secure-vibe: auto-start claude on first shell
if [[ $SHLVL -eq 1 ]]; then
  claude --dangerously-skip-permissions || true
  echo ""
  echo "Claude exited. Type 'claude' to restart."
fi
EOF

COPY --chown=viber:viber entrypoint.ts /home/viber/entrypoint.ts

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]