FROM ghcr.io/loice5/secure-vibe/base:latest

RUN curl -fsSL https://claude.ai/install.sh | bash

COPY --chown=viber:viber src/assets/claude-wrapper.sh /home/viber/bin/claude
RUN chmod +x /home/viber/bin/claude

RUN ln -s /home/viber/.local/bin/claude /home/viber/bin/claude-default

COPY --chown=viber:viber src/assets/bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/claude.ts /home/viber/entrypoint.ts
