FROM ghcr.io/homebrew/brew:latest AS homebrew

ENV HOMEBREW_NO_AUTO_UPDATE=1

RUN brew install gcc \
    && brew install-bundler-gems --groups= \
    && brew developer off \
    && rm -rf \
        /home/linuxbrew/.linuxbrew/Homebrew/Library/Taps/homebrew/homebrew-core \
        /home/linuxbrew/.linuxbrew/.homebrewdocker \
        /home/linuxbrew/.cache/Homebrew

RUN mkdir -p /tmp/rootfs/opt/linuxbrew-seed \
    && cp -a --parents /home/linuxbrew/.linuxbrew /tmp/rootfs \
    && cp -al /tmp/rootfs/home/linuxbrew/. /tmp/rootfs/opt/linuxbrew-seed/

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

RUN passwd -l root && usermod -s /usr/sbin/nologin root

COPY --from=homebrew --chown=viber:viber /tmp/rootfs/ /

USER viber
WORKDIR /home/viber/app

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"

# bun is PID 1, so it must live in an image layer and never under /home/linuxbrew,
# which the resettable secure-vibe-brew volume shadows at runtime.
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/viber/.bun/bin:${PATH}"

COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md
COPY --chown=viber:viber src/assets/sandbox-prompt-nodind.md /tmp/sandbox-prompt-nodind.md
RUN cat /tmp/sandbox-prompt-nodind.md >> /home/viber/.secure-vibe-sandbox.md && rm /tmp/sandbox-prompt-nodind.md

# /home/viber/bin sits first so the provider wrappers shadow the real binaries on PATH,
# including on the explicit-command entrypoint path, which never sources .bashrc.
RUN mkdir -p /home/viber/bin
ENV PATH="/home/viber/bin:/home/viber/.local/bin:${PATH}"

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]
