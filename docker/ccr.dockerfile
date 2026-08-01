FROM ubuntu:26.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# ── Root phase: system-level setup only ──────────────────────────────────────
# nodejs (22.x on Ubuntu 26.04, ABI 127) is required by CCR 3.x, which needs a real Node
# and a native better-sqlite3. npm is deliberately NOT installed — pnpm below is the package
# manager. python3 is deliberately absent too: a missing better-sqlite3 prebuild must fail
# fast rather than silently node-gyp-compiling under QEMU.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        build-essential \
        ca-certificates \
        unzip \
        nodejs \
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

# pnpm (self-contained, no npm) into an image layer. pnpm ≥10 refuses to run dependency
# lifecycle scripts unless explicitly allowed — that is why it is used here instead of npm.
#
# The release tarball is fetched directly rather than via get.pnpm.io/install.sh: that script
# delegates to `pnpm setup`, which detects the user's shell and edits a profile file to export
# PATH. Neither applies in a Dockerfile, and it does not reliably land the binary in $PNPM_HOME.
# Extracting the tarball ourselves makes the destination deterministic.
#
# Unpinned like the other installers here: the weekly no-cache rebuild tracks it, and both ways
# this can break are LOUD — the `pnpm --version` check below catches a bad install, and pnpm
# errors on unknown CLI options, so a renamed --allow-build fails the build rather than
# silently dropping the allowlist.
# $PNPM_HOME holds the pnpm binary; $PNPM_HOME/bin is where it links global package bins.
ENV PNPM_HOME="/home/viber/.pnpm"
ENV PATH="/home/viber/.pnpm:/home/viber/.pnpm/bin:${PATH}"
RUN set -eu \
    && case "$(uname -m)" in \
         x86_64)  PNPM_ARCH=x64 ;; \
         aarch64) PNPM_ARCH=arm64 ;; \
         *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
       esac \
    && PNPM_VERSION="$(node -e "fetch('https://registry.npmjs.org/-/package/pnpm/dist-tags').then(r=>r.json()).then(t=>console.log(t.latest))")" \
    && mkdir -p "$PNPM_HOME" \
    && curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linux-${PNPM_ARCH}.tar.gz" \
       | tar -xz -C "$PNPM_HOME" \
    && chmod +x "$PNPM_HOME/pnpm" \
    && pnpm --version

# Copy linuxbrew into the seed directory so the runtime volume can be populated
# on first run even though /home/linuxbrew will be shadowed by a named volume.
RUN cp -a /home/linuxbrew/. /opt/linuxbrew-seed/

# Install the native Claude CLI (claude.ai/install.sh → ~/.local/bin). The wrappers below
# launch it directly against CCR's gateway, adding the bypass flags + sandbox prompt.
RUN curl -fsSL https://claude.ai/install.sh | bash

# Install claude-code-router with pnpm into $PNPM_HOME — a normal image layer, NOT the
# shadowed brew volume, so there's no seed-ordering risk. Unpinned on purpose: the weekly
# no-cache CI rebuild picks up the latest CCR, same as the other provider images.
#
# --allow-build is an explicit, auditable allowlist: pnpm blocks ALL dependency install
# scripts by default, and better-sqlite3 is the one package permitted to run its own
# (prebuild-install, which downloads a prebuilt native binding — no compiler needed).
# If a future CCR release adds another script-running dependency the build FAILS with
# "Ignored build scripts: <pkg>" instead of silently executing it.
RUN pnpm add -g --allow-build=better-sqlite3 @musistudio/claude-code-router

# Smoke check: assert the native binding actually loads under this Node's ABI — the exact
# thing that broke the build when CCR 3.x introduced better-sqlite3. Resolving from the
# package's own directory keeps this independent of pnpm's (opaque, versioned) global store
# layout. Deliberately does NOT run `ccr serve`: that would create
# ~/.claude-code-router/config.sqlite in the image, and CCR only imports config.json when no
# sqlite store exists — baking one in would silently make every container ignore the user's
# mounted config, forever, with no error.
RUN set -eu \
    && CCR_PKG="$(find "$PNPM_HOME" -path '*/@musistudio/claude-code-router/package.json' -print -quit)" \
    && test -n "$CCR_PKG" \
    && node -e "require(require.resolve('better-sqlite3',{paths:['$(dirname "$CCR_PKG")']}));console.log('better-sqlite3 ok')"

COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md

# Starter config for the fallback scaffold path in the entrypoint (when no host config is
# mounted). Same single source the host runner imports, so the two scaffolds never drift.
COPY --chown=viber:viber src/assets/ccr-starter-config.json /home/viber/.ccr-starter-config.json

# /home/viber/bin sits ahead of ~/.local/bin and ~/.bun/bin so our wrappers shadow the
# real binaries on PATH — covers interactive shell, auto-start, AND the explicit-command
# entrypoint path (which never sources .bashrc).
RUN mkdir -p /home/viber/bin
ENV PATH="/home/viber/bin:/home/viber/.local/bin:/home/viber/.bun/bin:${PATH}"

# Command model — CCR 3.x dropped `ccr code`, so nothing spawns claude for us any more.
# Instead the entrypoint runs `ccr serve` as a sidecar gateway and exports
# ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN; these wrappers just launch the REAL claude by
# absolute path (never recursing) against it. They differ only in permission posture:
#   claude, ccr      → WITH --dangerously-skip-permissions
#   claude-default   → WITHOUT bypass, normal prompts
# Both append the sandbox T&Cs prompt, and both source the gateway env file so they work
# even under `docker exec`, which inherits nothing from PID 1.
COPY --chown=viber:viber src/assets/claude-bypass.sh /home/viber/bin/claude
COPY --chown=viber:viber src/assets/claude-bypass.sh /home/viber/bin/ccr
COPY --chown=viber:viber src/assets/claude-nobypass.sh /home/viber/bin/claude-default
RUN chmod +x /home/viber/bin/claude /home/viber/bin/ccr /home/viber/bin/claude-default

# Escape hatch to the raw ccr CLI (`ccr-default serve|stop|ui`), also used by the entrypoint
# to start the gateway. pnpm links it as a /bin/sh shim, so it is exec'd rather than passed to
# node; prepending /usr/bin means the node that shim finds is the ABI-matched one even if the
# user later runs `brew install node` (brew sits ahead of /usr/bin on PATH). The test -x makes
# a future change to pnpm's global bin layout fail the build loudly instead of at runtime.
RUN test -x "$PNPM_HOME/bin/ccr" \
    && printf '#!/usr/bin/env bash\nexport PATH="/usr/bin:$PATH"\nexec "%s/bin/ccr" "$@"\n' "$PNPM_HOME" > /home/viber/bin/ccr-default \
    && chmod +x /home/viber/bin/ccr-default

# CCR probes candidate node binaries before spawning its core gateway child; pin ours so the
# brew volume can never change the answer at runtime. CCR 3.x always binds a local management
# server too — keep it on loopback (no ports are published either way).
ENV CCR_NODE_BIN="/usr/bin/node" \
    CCR_WEB_HOST="127.0.0.1"

# Auto-start + PATH re-assertion appended to .bashrc. The SHLVL guard ensures
# auto-start fires only on the outermost bash, not on sub-shells.
COPY --chown=viber:viber src/assets/ccr-bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/ccr.ts /home/viber/entrypoint.ts

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]
