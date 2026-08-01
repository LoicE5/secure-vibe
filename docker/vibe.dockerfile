FROM ghcr.io/loice5/secure-vibe/base:latest

RUN curl -LsSf https://mistral.ai/vibe/install.sh | bash

RUN vibe --version

COPY --chown=viber:viber src/assets/vibe-wrapper.sh /home/viber/bin/vibe
RUN chmod +x /home/viber/bin/vibe

RUN ln -s /home/viber/.local/bin/vibe /home/viber/bin/vibe-default

COPY --chown=viber:viber src/assets/vibe-bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/vibe.ts /home/viber/entrypoint.ts
