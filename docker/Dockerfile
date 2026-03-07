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

RUN curl -fsSL https://claude.ai/install.sh | bash

ENV PATH="/home/viber/.local/bin:${PATH}"

# Aliases + auto-start appended to .bashrc.
# claude-default hits the real binary via `command`; claude always passes --dangerously-skip-permissions.
# The SHLVL guard ensures auto-start fires only on the outermost bash, not on sub-shells.
RUN printf '%s\n' \
    '' \
    '# secure-vibe: claude aliases' \
    "alias claude-default='command claude'" \
    "alias claude='claude --dangerously-skip-permissions'" \
    '' \
    '# secure-vibe: auto-start claude on first shell' \
    'if [[ $SHLVL -eq 1 && -z "${SECURE_VIBE_EXPLICIT_CMD:-}" ]]; then' \
    '  claude --dangerously-skip-permissions || true' \
    '  echo ""' \
    "  echo \"Claude exited. Type 'claude' to restart.\"" \
    'fi' \
    >> /home/viber/.bashrc

COPY --chown=viber:viber src/entrypoint.ts /home/viber/entrypoint.ts

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]