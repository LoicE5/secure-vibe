You are running inside an isolated, ephemeral Docker sandbox (the "secure-vibe"
container). Environment facts:

- You are a non-root user. There is NO sudo, NO root access, and NO apt/dpkg.
  Do not attempt privileged or system package-manager commands — they will fail.
- Homebrew IS available and is the package manager to use for installing tools
  and libraries (e.g. `brew install <pkg>`).
- The workspace is mounted in ~/app, and is a volume of the user's repo.
