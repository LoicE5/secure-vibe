ARG DOCKER_VERSION=29.7.0
ARG BUILDX_VERSION=0.36.0
ARG COMPOSE_VERSION=v5.3.1
ARG BASE_IMAGE=ghcr.io/loice5/secure-vibe/claude:latest

FROM docker:${DOCKER_VERSION}-dind AS docker-dist
ARG DOCKER_VERSION
# The rootless extras are the one piece the official image leaves out, and the URL's
# architecture names are exactly what uname reports, so no arch mapping is needed.
RUN wget -qO- "https://download.docker.com/linux/static/stable/$(uname -m)/docker-rootless-extras-${DOCKER_VERSION}.tgz" \
    | tar -xz -C /usr/local/bin --strip-components=1

FROM docker/buildx-bin:${BUILDX_VERSION} AS buildx-dist

FROM docker/compose-bin:${COMPOSE_VERSION} AS compose-dist

FROM ${BASE_IMAGE}

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        uidmap \
        slirp4netns \
        passt \
        fuse-overlayfs \
        iptables \
        iproute2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=docker-dist \
     /usr/local/bin/docker \
     /usr/local/bin/dockerd \
     /usr/local/bin/dockerd-rootless.sh \
     /usr/local/bin/rootlesskit \
     /usr/local/bin/containerd \
     /usr/local/bin/containerd-shim-runc-v2 \
     /usr/local/bin/runc \
     /usr/local/bin/docker-proxy \
     /usr/local/bin/docker-init \
     /usr/local/bin/
COPY --from=buildx-dist /buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
COPY --from=compose-dist /docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

RUN dockerd --version \
    && rootlesskit --version \
    && docker buildx version \
    && docker compose version

# usermod -l left the cloud image's `ubuntu:` entry behind, and newuidmap looks the name up.
RUN printf 'viber:100000:65536\n' > /etc/subuid \
    && printf 'viber:100000:65536\n' > /etc/subgid

RUN install -d -m 0700 -o viber -g viber /run/user/1000 \
    && install -d -m 0700 -o viber -g viber /home/viber/.local/share/docker

ENV XDG_RUNTIME_DIR="/run/user/1000" \
    DOCKER_HOST="unix:///run/user/1000/docker.sock"

USER viber

# Re-copied, not appended to: it drops the no-Docker paragraph the base image added.
COPY --chown=viber:viber src/assets/sandbox-prompt.md /home/viber/.secure-vibe-sandbox.md
COPY --chown=viber:viber src/assets/sandbox-prompt-dind.md /tmp/sandbox-prompt-dind.md
RUN cat /tmp/sandbox-prompt-dind.md >> /home/viber/.secure-vibe-sandbox.md && rm /tmp/sandbox-prompt-dind.md

COPY --chown=viber:viber src/entrypoints/dind-init.ts /home/viber/dind-init.ts

ENTRYPOINT ["bun", "/home/viber/dind-init.ts"]
