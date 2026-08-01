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

# One RUN: the cache is only reclaimable here, and hardlinking a lower layer copies it up.
RUN curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash \
    && eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)" \
    && brew update \
    && brew install gcc \
    && rm -rf /home/viber/.cache/Homebrew \
    && cp -al /home/linuxbrew/. /opt/linuxbrew-seed/

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"

# bun is PID 1, so it must live in an image layer and never under /home/linuxbrew,
# which the resettable secure-vibe-brew volume shadows at runtime.
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/viber/.bun/bin:${PATH}"

COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md

# /home/viber/bin sits first so the provider wrappers shadow the real binaries on PATH,
# including on the explicit-command entrypoint path, which never sources .bashrc.
RUN mkdir -p /home/viber/bin
ENV PATH="/home/viber/bin:/home/viber/.local/bin:${PATH}"

ENTRYPOINT ["bun", "/home/viber/entrypoint.ts"]
