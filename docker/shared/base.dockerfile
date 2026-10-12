FROM ghcr.io/homebrew/brew:latest AS homebrew

ENV HOMEBREW_NO_AUTO_UPDATE=1

RUN brew install gcc \
    && brew install-bundler-gems --groups= \
    && brew developer off \
    && rm -rf \
        /home/linuxbrew/.linuxbrew/Homebrew/Library/Taps/homebrew/homebrew-core \
        /home/linuxbrew/.linuxbrew/.homebrewdocker \
        /home/linuxbrew/.cache/Homebrew
FROM ubuntu:26.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        build-essential \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN usermod -l viber -d /home/viber -m ubuntu \
    && groupmod -n viber ubuntu \
    && install -d -o viber -g viber /home/linuxbrew

RUN passwd -l root && usermod -s /usr/sbin/nologin root

COPY --from=homebrew --chown=viber:viber \
    /home/linuxbrew/.linuxbrew/ /opt/linuxbrew-seed/.linuxbrew/
COPY --from=oven/bun:slim --chown=viber:viber /usr/local/bin/bun /home/viber/.bun/bin/bun

USER viber
WORKDIR /home/viber/app

ENV HOMEBREW_NO_AUTO_UPDATE=1
ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"

# Bun must remain outside the resettable Homebrew volume.
ENV BUN_INSTALL="/home/viber/.bun"
ENV PATH="/home/viber/.bun/bin:${PATH}"
RUN ln -s bun /home/viber/.bun/bin/bunx \
    && bun --version \
    && bunx --version

COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md
COPY --chown=viber:viber src/assets/sandbox-prompt-nodind.md /tmp/sandbox-prompt-nodind.md
RUN cat /tmp/sandbox-prompt-nodind.md >> /home/viber/.secure-vibe-sandbox.md && rm /tmp/sandbox-prompt-nodind.md

# /home/viber/bin sits first so the provider wrappers shadow the real binaries on PATH,
# including on the explicit-command entrypoint path, which never sources .bashrc.
RUN mkdir -p /home/viber/bin
ENV PATH="/home/viber/bin:/home/viber/.local/bin:${PATH}"

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]
