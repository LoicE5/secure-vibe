import { access, readFile } from "fs/promises"
import { $ } from "bun"
import { OPENCODE_INLINE_VARIABLES, prepareOpenCodeFiles, remapOpenCodeConfig, type OpenCodeSetup } from "./opencode-config"

const brewReady = await access("/home/linuxbrew/.linuxbrew").then(() => true).catch(() => false)
if(!brewReady) {
  console.info("  [entrypoint] First run: seeding brew volume from image (this may take a minute)…")
  await $`cp -a /opt/linuxbrew-seed/. /home/linuxbrew/`.nothrow()
  console.info("  [entrypoint] Brew volume ready.")
} else {
  const { exitCode } = await $`test -w /home/linuxbrew/.linuxbrew/Cellar`.nothrow().quiet()
  if(exitCode !== 0) {
    console.warn("  [entrypoint] The brew volume is owned by a different UID — brew will fail to install packages.")
    console.warn("  [entrypoint] Reset it from the host with: docker volume rm secure-vibe-brew")
  }
}

const setup: OpenCodeSetup = process.env.SECURE_VIBE_OPENCODE_SETUP
  ? JSON.parse(process.env.SECURE_VIBE_OPENCODE_SETUP)
  : {
    copies: [],
    mappings: [],
    configFiles: [],
    hostHome: "/home/viber",
    agentsPath: "/home/viber/.config/opencode/AGENTS.md"
  }
delete process.env.SECURE_VIBE_OPENCODE_SETUP
const prompt = await readFile("/home/viber/.secure-vibe-sandbox.md", "utf-8")
await prepareOpenCodeFiles(setup, prompt)
for(const name of OPENCODE_INLINE_VARIABLES) {
  const value = process.env[name]
  if(value) process.env[name] = remapOpenCodeConfig(value, setup, name === "OPENCODE_PERMISSION")
}
process.env.OPENCODE_DISABLE_AUTOUPDATE = "1"

if(process.env.GIT_USER_NAME) await $`git config --global user.name ${process.env.GIT_USER_NAME}`.quiet().nothrow()
if(process.env.GIT_USER_EMAIL) await $`git config --global user.email ${process.env.GIT_USER_EMAIL}`.quiet().nothrow()

process.on("SIGINT", () => {})
const command = process.argv.slice(2)
const explicit = command.length > 0
const child = Bun.spawn(explicit ? command : ["bash", "-i"], {
  env: explicit ? { ...process.env, SECURE_VIBE_EXPLICIT_CMD: "1" } : process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
})
process.on("SIGTERM", () => child.kill("SIGTERM"))
process.exit(await child.exited)
