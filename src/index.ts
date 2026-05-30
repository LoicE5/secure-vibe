import { parseArgs, getEnvConfig, getBoolEnv } from "./utils/args"
import { runCompletion } from "./utils/completion"
import { selectDirectory } from "./utils/select-directory"
import { selectSaveOption } from "./utils/select-save"
import { selectRuntime } from "./utils/select-runtime"
import { resolveGitConfig } from "./utils/git-identity"
import { saveDirectory } from "./utils/save-directory"
import { parseExcludePatterns, resolveExcludedFiles, moveSecretsOut, moveSecretsBack } from "./utils/secrets"
import { ensureImage } from "./utils/image"
import { resolveProviderRunner } from "./providers"
import { CLAUDE_PROVIDER_SPEC } from "./providers/claude/spec"
import { CLEAN_EXIT_CODES } from "./constants"

// ── Dynamic shell completion ────────────────────────────────────────────────
// The installed shell stub calls `secure-vibe __complete <words…>` on each TAB.
// Handle it before anything else (no image build, no prompts) and exit.
if(process.argv[2] === "__complete") {
  runCompletion(process.argv.slice(3))
  process.exit(0)
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = parseArgs()

// Resolve config: CLI > ENV (null if unset or set to "prompt")
const dirValue     = args.directory    ?? getEnvConfig("DIRECTORY")
const saveValue    = args.save         ?? getEnvConfig("SAVE")
const rtValue      = args.runtime      ?? getEnvConfig("RUNTIME")
const cmdValue     = args.command      ?? getEnvConfig("COMMAND")
const excludeValue = args.exclude      ?? getEnvConfig("EXCLUDE")
const buildFlag    = args.build        || getBoolEnv("BUILD")
const buildNCFlag  = args.buildNoCache || getBoolEnv("BUILD_NO_CACHE")
const pullFlag     = args.pull         || getBoolEnv("PULL")
const providerId   = args.provider     ?? "claude"

console.info("── secure-vibe ──────────────────────────────────────────")

// Resolved early — fails fast with a clear message before we touch the filesystem
// or a container runtime if the user named an unimplemented provider.
const runProvider = resolveProviderRunner(providerId)

const workDir = await selectDirectory(dirValue)
console.info(`  Mounting: ${workDir}`)

const saveMode = await selectSaveOption(saveValue)

const runtime = await selectRuntime(rtValue)
const gitConfig = await resolveGitConfig()

if(saveMode !== "no") await saveDirectory(workDir, saveMode)

// TODO(multi-provider): swap CLAUDE_PROVIDER_SPEC for a per-provider spec lookup
// (PROVIDER_SPECS[providerId]) once a second provider lands.
await ensureImage(runtime, CLAUDE_PROVIDER_SPEC, buildFlag, buildNCFlag, pullFlag)

// Resolve files to exclude — done after ensureImage so pre-flight failures
// (which call process.exit internally) never leave files displaced.
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
  exitCode = await runProvider({ runtime, workDir, command: cmdValue, gitConfig })
} finally {
  if(secretsDir) await moveSecretsBack(workDir, secretsDir)
}

process.exit(CLEAN_EXIT_CODES.has(exitCode) ? 0 : exitCode)
