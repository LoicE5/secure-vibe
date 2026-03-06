import { parseArg, selectDirectory, selectSaveOption, selectRuntime, resolveCredentials, ensureImage, runContainer, saveDirectory } from "./functions"

// ── Main ──────────────────────────────────────────────────────────────────────

const saveArg = parseArg("--save")

console.info("── secure-vibe ──────────────────────────────────────────")

const workDir = await selectDirectory()
console.info(`  Mounting: ${workDir}`)

const saveMode = await selectSaveOption(workDir, saveArg)

const runtime = await selectRuntime()
const credentialsJson = await resolveCredentials()

if (saveMode !== "no") await saveDirectory(workDir, saveMode)

await ensureImage(runtime)
console.info(`Starting container shell. Default entrypoint : Claude - bypass permissions`)
const exitCode = await runContainer(runtime, workDir, credentialsJson)

process.exit(exitCode)
