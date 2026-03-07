import { join } from "path"

const arch = process.argv.at(2) as "arm64" | "x64" | undefined

const validArchs = ["arm64", "x64"]
if(arch && !validArchs.includes(arch)) {
  console.error(`Invalid arch: ${arch}. Must be one of: ${validArchs.join(", ")}`)
  process.exit(1)
}

const targetMap: Record<string, string> = {
  arm64: "bun-darwin-arm64",
  x64: "bun-darwin-x64"
}

const outfile = join(import.meta.dir, "..", "dist", arch ? `secure-vibe-${arch}` : "secure-vibe")

const buildArgs = ["build", "--compile", "src/index.ts", "--outfile", outfile]
if(arch) buildArgs.push("--target", targetMap[arch])

const buildProcess = Bun.spawn(["bun", ...buildArgs], { stdio: ["inherit", "inherit", "inherit"] })
await buildProcess.exited
process.exit(buildProcess.exitCode ?? 0)
