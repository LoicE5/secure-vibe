FROM ubuntu:26.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        build-essential \
        ca-certificates \
        unzip \
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

# bun is PID 1 and installs codex below, so it must live in an image layer and never under
# /home/linuxbrew, which the resettable secure-vibe-brew volume shadows at runtime.
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/viber/.bun/bin:${PATH}"

RUN cp -a /home/linuxbrew/. /opt/linuxbrew-seed/

RUN bun install -g @openai/codex

COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md

# /home/viber/bin sits first so the wrapper below shadows the real codex on PATH,
# including on the explicit-command entrypoint path, which never sources .bashrc.
RUN mkdir -p /home/viber/bin
ENV PATH="/home/viber/bin:/home/viber/.bun/bin:${PATH}"

# codex's bin script has a `#!/usr/bin/env node` shebang; this shim means no real node.
RUN printf '#!/usr/bin/env bash\nexec bun "$@"\n' > /home/viber/bin/node \
    && chmod +x /home/viber/bin/node

COPY --chown=viber:viber src/assets/codex-wrapper.sh /home/viber/bin/codex
RUN chmod +x /home/viber/bin/codex

# A wrapper, not a symlink: it must disable codex's own sandbox, which cannot create
# user namespaces inside the container.
COPY --chown=viber:viber src/assets/codex-default.sh /home/viber/bin/codex-default
RUN chmod +x /home/viber/bin/codex-default

COPY --chown=viber:viber src/assets/codex-bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/codex.ts /home/viber/entrypoint.ts

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]
