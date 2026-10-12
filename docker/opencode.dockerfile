FROM ghcr.io/loice5/secure-vibe/base:latest

ENV HOME="/home/viber" \
    XDG_CONFIG_HOME="/home/viber/.config" \
    XDG_DATA_HOME="/home/viber/.local/share" \
    XDG_STATE_HOME="/home/viber/.local/state" \
    XDG_CACHE_HOME="/home/viber/.cache" \
    OPENCODE_DISABLE_AUTOUPDATE=1

RUN curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path \
    && /home/viber/.opencode/bin/opencode --version

RUN bun add --cwd /home/viber --exact jsonc-parser@3.3.1

COPY --chown=viber:viber --chmod=+x src/assets/opencode-wrapper.sh /home/viber/bin/opencode
RUN ln -s /home/viber/.opencode/bin/opencode /home/viber/bin/opencode-default

COPY --chown=viber:viber src/assets/opencode-bashrc-append.sh /tmp/bashrc-append.sh
RUN cat /tmp/bashrc-append.sh >> /home/viber/.bashrc && rm /tmp/bashrc-append.sh

COPY --chown=viber:viber src/entrypoints/opencode.ts /home/viber/entrypoint.ts
COPY --chown=viber:viber src/entrypoints/opencode-config.ts /home/viber/opencode-config.ts
