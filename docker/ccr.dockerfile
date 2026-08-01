FROM ghcr.io/loice5/secure-vibe/base:latest

# Not in the base: a real node would defeat the codex image's node-to-bun shim.
# No npm and no python3 on purpose: pnpm is the package manager, and a missing
# better-sqlite3 prebuild must fail fast rather than node-gyp-compile under QEMU.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        nodejs \
    && rm -rf /var/lib/apt/lists/*
USER viber

# The tarball is fetched directly rather than via get.pnpm.io/install.sh, which delegates
# to `pnpm setup` — a shell-profile editor that does nothing useful in a Dockerfile.
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

# Re-asserted after PNPM_HOME, whose bin holds a real `ccr` that would shadow the wrapper.
ENV PATH="/home/viber/bin:/home/viber/.local/bin:/home/viber/.bun/bin:${PATH}"

RUN curl -fsSL https://claude.ai/install.sh | bash

# --allow-build is an explicit allowlist: pnpm blocks all dependency install scripts by
# default, so a future CCR release adding one fails the build instead of running it.
RUN pnpm add -g --allow-build=better-sqlite3 @musistudio/claude-code-router

# Asserts the native binding loads under this Node's ABI. Deliberately does NOT run
# `ccr serve`: that would bake a config.sqlite into the image, and CCR imports config.json
# only when no sqlite store exists — every container would ignore the mounted config.
RUN set -eu \
    && CCR_PKG="$(find "$PNPM_HOME" -path '*/@musistudio/claude-code-router/package.json' -print -quit)" \
    && test -n "$CCR_PKG" \
    && node -e "require(require.resolve('better-sqlite3',{paths:['$(dirname "$CCR_PKG")']}));console.log('better-sqlite3 ok')"

COPY --chown=viber:viber src/assets/ccr-starter-config.json /home/viber/.ccr-starter-config.json

# claude and ccr bypass permissions, claude-default keeps the normal prompts.
COPY --chown=viber:viber src/assets/claude-bypass.sh /home/viber/bin/claude
COPY --chown=viber:viber src/assets/claude-bypass.sh /home/viber/bin/ccr
COPY --chown=viber:viber src/assets/claude-nobypass.sh /home/viber/bin/claude-default
RUN chmod +x /home/viber/bin/claude /home/viber/bin/ccr /home/viber/bin/claude-default

# Prepending /usr/bin pins the ABI-matched node even if the user later brew-installs one.
RUN test -x "$PNPM_HOME/bin/ccr" \
    && printf '#!/usr/bin/env bash\nexport PATH="/usr/bin:$PATH"\nexec "%s/bin/ccr" "$@"\n' "$PNPM_HOME" > /home/viber/bin/ccr-default \
    && chmod +x /home/viber/bin/ccr-default

# CCR probes candidate node binaries before spawning its gateway child; pin ours so the
# brew volume can never change the answer, and keep its management server on loopback.
ENV CCR_NODE_BIN="/usr/bin/node" \
    CCR_WEB_HOST="127.0.0.1"

COPY --chown=viber:viber src/assets/ccr-bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/ccr.ts /home/viber/entrypoint.ts
