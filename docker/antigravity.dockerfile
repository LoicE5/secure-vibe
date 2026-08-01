FROM ghcr.io/loice5/secure-vibe/base:latest

RUN curl -fsSL https://antigravity.google/cli/install.sh | bash

COPY --chown=viber:viber src/assets/antigravity-wrapper.sh /home/viber/bin/agy
RUN chmod +x /home/viber/bin/agy

RUN ln -s /home/viber/.local/bin/agy /home/viber/bin/agy-default

COPY --chown=viber:viber src/assets/antigravity-bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/antigravity.ts /home/viber/entrypoint.ts
