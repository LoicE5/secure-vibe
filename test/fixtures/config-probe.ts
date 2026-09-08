import type { ParsedArgs } from "../../src/types"
import { resolveConfiguration } from "../../src/utils/args"
import { loadDotEnv } from "../../src/utils/env-file"

const args = {
  directory: null,
  save: null,
  runtime: null,
  command: null,
  exclude: null,
  build: false,
  buildNoCache: false,
  pull: false,
  local: false,
  dind: false,
  provider: null
} satisfies ParsedArgs

const projectDotEnv = await loadDotEnv(process.cwd())
console.info(JSON.stringify({
  configuration: resolveConfiguration(args),
  projectCredential: projectDotEnv.CCR_TEST_KEY ?? null,
  projectControl: projectDotEnv.SECURE_VIBE_PROVIDER ?? null
}))
