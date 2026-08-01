import { parseArgs, getEnvConfig, getBoolEnv } from "./utils/args"
import { runCompletion } from "./utils/completion"
import { selectDirectory } from "./utils/select-directory"
import { selectSaveOption } from "./utils/select-save"
import { selectRuntime } from "./utils/select-runtime"
import { resolveGitConfig } from "./utils/git-identity"
import { saveDirectory } from "./utils/save-directory"
import { parseExcludePatterns, resolveExcludedFiles, moveSecretsOut, moveSecretsBack } from "./utils/secrets"
import { ensureImage } from "./utils/image"
import { resolveProviderRunner, resolveProviderSpec } from "./providers"
import { CLEAN_EXIT_CODES } from "./constants"

// The installed shell stub calls this on each TAB; handle it before anything else.
if(process.argv.at(2) === "__complete") {
  runCompletion(process.argv.slice(3))
  process.exit(0)
}

const args = parseArgs()

const dirValue     = args.directory    ?? getEnvConfig("DIRECTORY")
const saveValue    = args.save         ?? getEnvConfig("SAVE")
const rtValue      = args.runtime      ?? getEnvConfig("RUNTIME")
const cmdValue     = args.command      ?? getEnvConfig("COMMAND")
const excludeValue = args.exclude      ?? getEnvConfig("EXCLUDE")
const buildFlag    = args.build        || getBoolEnv("BUILD")
const buildNCFlag  = args.buildNoCache || getBoolEnv("BUILD_NO_CACHE")
const pullFlag     = args.pull         || getBoolEnv("PULL")
const localFlag    = args.local        || getBoolEnv("LOCAL")
const dindFlag     = args.dind         || getBoolEnv("DIND")
const providerId   = args.provider     ?? "claude"

if(localFlag && providerId !== "ccr") {
  console.warn(`  ⚠ --local has no effect with the '${providerId}' provider (ccr only); ignoring.`)
}

console.info("── secure-vibe ──────────────────────────────────────────")

// Resolved early so an unimplemented provider fails before we touch the filesystem.
const runProvider = resolveProviderRunner(providerId)

const workDir = await selectDirectory(dirValue)
console.info(`  Mounting: ${workDir}`)

const saveMode = await selectSaveOption(saveValue)

const runtime = await selectRuntime(rtValue)

if(dindFlag && runtime !== "docker") {
  console.warn(`  ⚠ --dind is only tested on docker; nesting a rootless daemon inside '${runtime}' may fail.`)
}

const gitConfig = await resolveGitConfig()

if(saveMode !== "no") await saveDirectory(workDir, saveMode)

const providerSpec = resolveProviderSpec(providerId, dindFlag)
await ensureImage(runtime, providerSpec, buildFlag, buildNCFlag, pullFlag)

// After ensureImage, so a pre-flight process.exit never leaves files displaced.
const excludedFiles = excludeValue
  ? await resolveExcludedFiles(workDir, parseExcludePatterns(excludeValue))
  : []

console.info(`\x1b[32mStarting container. Entrypoint: ${cmdValue ?? `${providerId} - bypass permissions`}\x1b[0m`)

let secretsDir: string | null = null
let exitCode = 0
try {
  if(excludedFiles.length > 0) {
    secretsDir = await moveSecretsOut(workDir, excludedFiles)
    console.info(`  Secrets moved: ${excludedFiles.length} file(s) → ${secretsDir}`)
  }
  exitCode = await runProvider({ runtime, spec: providerSpec, workDir, command: cmdValue, gitConfig, local: localFlag })
} finally {
  if(secretsDir) await moveSecretsBack(workDir, secretsDir)
}

process.exit(CLEAN_EXIT_CODES.has(exitCode) ? 0 : exitCode)
