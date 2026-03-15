import { join } from "path"

type Target = "linux-x64" | "linux-arm64" | "macos-x64" | "macos-arm64"

const BUN_TARGET: Record<Target, string> = {
  "linux-x64":   "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "macos-x64":   "bun-darwin-x64",
  "macos-arm64": "bun-darwin-arm64",
}

const ALL_TARGETS = Object.keys(BUN_TARGET) as Target[]

const requestedTarget = process.argv.at(2) as Target | undefined

if(requestedTarget !== undefined && !(requestedTarget in BUN_TARGET)) {
  console.error(`Unknown target "${requestedTarget}". Valid targets: ${ALL_TARGETS.join(", ")}`)
  process.exit(1)
}

const targets: Target[] = requestedTarget ? [requestedTarget] : ALL_TARGETS

const projectRoot = join(import.meta.dir, "..")

for(const target of targets) {
  const outfile = join(projectRoot, "dist", `secure-vibe-${target}`)
  console.info(`Building ${target} → ${outfile}`)

  const buildArgs = ["build", "--compile", `${projectRoot}/src/index.ts`, `--target=${BUN_TARGET[target]}`, `--outfile=${outfile}`]

  const buildProcess = Bun.spawn(["bun", ...buildArgs], { stdio: ["inherit", "inherit", "inherit"] })
  await buildProcess.exited
  if(buildProcess.exitCode !== 0) process.exit(buildProcess.exitCode ?? 1)
}
