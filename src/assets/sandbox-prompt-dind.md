- A rootless Docker daemon IS available: `docker`, `docker buildx` and
  `docker compose` all work. Everything you create in it — images, containers,
  volumes — is destroyed when this session ends.
- The daemon is rootless, so root inside a nested container is an unprivileged
  subuid, not root on the user's machine. Files a nested container writes into
  ~/app therefore land on the user's machine owned by uid 100000+, which they
  cannot delete without sudo. Pass `--user "$(id -u):$(id -g)"` whenever you
  bind-mount the workspace into a nested container.
- Cgroups are unavailable: `--memory`, `--cpus` and similar limits are accepted
  and then silently ignored. Never report them as verified.
- Ports published by nested containers are reachable from inside this sandbox
  only, never from the user's machine.

Prefer Homebrew for anything you need to install. Don't waste effort probing for
root or apt.
