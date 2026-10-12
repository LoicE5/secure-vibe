import { access } from "fs/promises"
import MODELS_DEV_ENV from "../../assets/opencode-provider-env.json"
import { parseOpenCodeConfig, remapOpenCodeConfig, translateOpenCodePath } from "../../entrypoints/opencode-config"
import type { OpenCodeConfiguration } from "./config"

const NATIVE_INLINE_VARIABLES = ["OPENCODE_CONFIG_CONTENT", "OPENCODE_PERMISSION"]
const RESERVED_VARIABLES = new Set([
  "HOME", "PATH", "USER", "LOGNAME", "SHELL", "SHLVL", "PWD", "OLDPWD", "BUN_INSTALL", "ENV", "BASH_ENV",
  "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_TUI_CONFIG", "OPENCODE_TEST_HOME", "OPENCODE_DISABLE_AUTOUPDATE"
])

/** Finds explicit env substitutions and custom provider env declarations in parsed settings. */
export function referencedOpenCodeVariables(configs: string[]): string[] {
  const names = new Set<string>()
  /** Visits strings for OpenCode's native env substitution syntax. */
  function visit(value: unknown): void {
    if(typeof value === "string") {
      for(const match of value.matchAll(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)) names.add(match.at(1)!)
    } else if(Array.isArray(value)) {
      value.forEach(visit)
    } else if(value && typeof value === "object") {
      Object.values(value).forEach(visit)
    }
  }
  for(const raw of configs) {
    try {
      const config = parseOpenCodeConfig(raw)
      visit(config)
      if(!config || typeof config !== "object") continue
      for(const field of ["provider", "providers"]) {
        const providers = Reflect.get(config, field)
        if(!providers || typeof providers !== "object") continue
        for(const provider of Object.values(providers)) {
          if(!provider || typeof provider !== "object" || !("env" in provider) || !Array.isArray(provider.env)) continue
          for(const name of provider.env) {
            if(typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) names.add(name)
          }
        }
      }
    } catch(configError: unknown) {
      console.warn("  Could not discover environment references in an OpenCode config:", configError)
    }
  }
  return [...names]
}

/** Selects provider credentials with project dotenv precedence and protects container-owned variables. */
export async function resolveOpenCodeEnvironment(configuration: OpenCodeConfiguration, dotEnv: Record<string, string>, environment: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const selected = new Set([...MODELS_DEV_ENV.variables, ...NATIVE_INLINE_VARIABLES, ...referencedOpenCodeVariables(configuration.configs)])
  const forwarded: Record<string, string> = {}
  for(const name of selected) {
    if(RESERVED_VARIABLES.has(name) || name.startsWith("XDG_") || name.startsWith("SECURE_VIBE_") || name.startsWith("GIT_USER_")) continue
    const value = dotEnv[name] ?? environment[name]
    if(value === undefined) continue
    forwarded[name] = name === "OPENCODE_CONFIG_CONTENT"
      ? remapOpenCodeConfig(value, configuration.setup)
      : translateOpenCodePath(value, configuration.setup.mappings, configuration.setup.hostHome)
  }
  if(Object.keys(forwarded).length > 0) {
    console.info(`  OpenCode forwarding: ${Object.keys(forwarded).join(", ")} (project .env takes precedence).`)
  }
  const hasAuth = await access(configuration.authPath).then(() => true).catch(() => false)
  console.info(hasAuth
    ? `  OpenCode saved credentials: ${configuration.authPath} (disposable copy).`
    : "  No saved OpenCode credentials — native model selection and authentication remain available.")
  return {
    ...forwarded,
    ...configuration.environment,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    SECURE_VIBE_OPENCODE_SETUP: JSON.stringify(configuration.setup)
  }
}
