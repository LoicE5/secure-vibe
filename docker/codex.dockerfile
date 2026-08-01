FROM ghcr.io/loice5/secure-vibe/base:latest

RUN bun install -g @openai/codex

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
