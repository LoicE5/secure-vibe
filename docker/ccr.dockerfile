FROM ghcr.io/loice5/secure-vibe/base:latest

# Keep Node out of the base so Codex can use its node-to-bun shim.
# No Python: a missing SQLite prebuild must fail rather than compile under QEMU.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        nodejs \
        libatomic1 \
    && rm -rf /var/lib/apt/lists/*
USER viber

ENV PNPM_HOME="/home/viber/.pnpm"
ENV PATH="/home/viber/.pnpm:/home/viber/.pnpm/bin:${PATH}"
COPY --from=ghcr.io/pnpm/pnpm:latest --chown=viber:viber /opt/pnpm/pnpm /home/viber/.pnpm/pnpm

# Re-asserted after PNPM_HOME, whose bin holds a real `ccr` that would shadow the wrapper.
ENV PATH="/home/viber/bin:/home/viber/.local/bin:/home/viber/.bun/bin:${PATH}"

RUN curl -fsSL https://claude.ai/install.sh | bash

# Allow only SQLite's native dependency build script.
RUN pnpm add -g --allow-build=better-sqlite3 @musistudio/claude-code-router

# Exercise the native binding without creating CCR state that would block config import.
RUN set -eu \
    && CCR_PKG="$(find "$PNPM_HOME" -path '*/@musistudio/claude-code-router/package.json' -print -quit)" \
    && test -n "$CCR_PKG" \
    && node -e "const Database=require(require.resolve('better-sqlite3',{paths:['$(dirname "$CCR_PKG")']}));const db=new Database(':memory:');if(db.prepare('SELECT 1 AS ok').get().ok!==1)throw new Error('SQLite query failed');db.close();console.info('better-sqlite3 ok')"

COPY --chown=viber:viber src/assets/ccr-starter-config.json /home/viber/.ccr-starter-config.json

# claude and ccr bypass permissions, claude-default keeps the normal prompts.
COPY --chown=viber:viber --chmod=+x src/assets/claude-bypass.sh /home/viber/bin/claude
COPY --chown=viber:viber --chmod=+x src/assets/claude-bypass.sh /home/viber/bin/ccr
COPY --chown=viber:viber --chmod=+x src/assets/claude-nobypass.sh /home/viber/bin/claude-default

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
