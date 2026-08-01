FROM ubuntu:26.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# No npm and no python3 on purpose: pnpm is the package manager, and a missing
# better-sqlite3 prebuild must fail fast rather than node-gyp-compile under QEMU.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        build-essential \
        ca-certificates \
        unzip \
        nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN usermod -l viber -d /home/viber -m ubuntu \
    && groupmod -n viber ubuntu

RUN mkdir -p /home/linuxbrew && chown viber:viber /home/linuxbrew

RUN mkdir -p /opt/linuxbrew-seed && chown viber:viber /opt/linuxbrew-seed

RUN passwd -l root && usermod -s /usr/sbin/nologin root

USER viber
WORKDIR /home/viber/app

RUN curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"

RUN brew update && \
    brew install gcc

# bun is PID 1, so it must live in an image layer and never under /home/linuxbrew,
# which the resettable secure-vibe-brew volume shadows at runtime.
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/viber/.bun/bin:${PATH}"

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

RUN cp -a /home/linuxbrew/. /opt/linuxbrew-seed/

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

COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md

COPY --chown=viber:viber src/assets/ccr-starter-config.json /home/viber/.ccr-starter-config.json

# /home/viber/bin sits first so the wrappers below shadow the real binaries on PATH,
# including on the explicit-command entrypoint path, which never sources .bashrc.
RUN mkdir -p /home/viber/bin
ENV PATH="/home/viber/bin:/home/viber/.local/bin:/home/viber/.bun/bin:${PATH}"

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

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]
