import { parseArgs, getEnvConfig, getBoolEnv, selectDirectory, selectSaveOption, selectRuntime, resolveCredentials, ensureImage, runContainer, saveDirectory } from "./functions"
import { CLEAN_EXIT_CODES } from "./constants"

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs()

// Resolve config: CLI > ENV (null if unset or set to "prompt")
const dirValue    = args.directory    ?? getEnvConfig("DIRECTORY")
const saveValue   = args.save         ?? getEnvConfig("SAVE")
const rtValue     = args.runtime      ?? getEnvConfig("RUNTIME")
const cmdValue    = args.command      ?? getEnvConfig("COMMAND")
const buildFlag   = args.build        || getBoolEnv("BUILD")
const buildNCFlag = args.buildNoCache || getBoolEnv("BUILD_NO_CACHE")

console.info("── secure-vibe ──────────────────────────────────────────")

const workDir = await selectDirectory(dirValue)
console.info(`  Mounting: ${workDir}`)

const saveMode = await selectSaveOption(workDir, saveValue)

const runtime = await selectRuntime(rtValue)
const credentialsJson = await resolveCredentials()

if (saveMode !== "no") await saveDirectory(workDir, saveMode)

await ensureImage(runtime, buildFlag, buildNCFlag)
console.info(`\x1b[32mStarting container. Entrypoint: ${cmdValue ?? "Claude - bypass permissions"}\x1b[0m`)
const exitCode = await runContainer(runtime, workDir, credentialsJson, cmdValue)

process.exit(CLEAN_EXIT_CODES.has(exitCode) ? 0 : exitCode)
