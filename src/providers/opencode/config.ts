import { stat, readFile, realpath } from "fs/promises"
import { homedir } from "os"
import { isAbsolute, join, resolve } from "path"
import type { ExtraMount } from "../../utils/container"
import { BANNED_DIRS } from "../../constants"
import { OPENCODE_CONFIG_NAMES, isWithinDirectory, translateOpenCodePath, type OpenCodeSetup } from "../../entrypoints/opencode-config"

export const OPENCODE_CONTAINER_HOME = "/home/viber"

export interface OpenCodeDirectories {
  config: string
  data: string
  state: string
  home: string
}

export interface OpenCodeConfiguration {
  setup: OpenCodeSetup
  mounts: ExtraMount[]
  environment: Record<string, string>
  configs: string[]
  authPath: string
}

/** Resolves native XDG directories, ignoring relative XDG values as xdg-basedir does. */
export function resolveOpenCodeDirectories(environment: NodeJS.ProcessEnv = process.env, home: string = homedir()): OpenCodeDirectories {
  /** Resolves one XDG root with its native home fallback. */
  function xdg(key: string, fallback: string): string {
    const configured = environment[key]
    return join(configured && isAbsolute(configured) ? configured : join(home, fallback), "opencode")
  }
  return {
    config: xdg("XDG_CONFIG_HOME", ".config"),
    data: xdg("XDG_DATA_HOME", ".local/share"),
    state: xdg("XDG_STATE_HOME", ".local/state"),
    home: join(home, ".opencode")
  }
}

/** Plans read-only staging mounts and writable copies without creating host files. */
export async function resolveOpenCodeConfiguration(workDir: string, environment: NodeJS.ProcessEnv = process.env, home: string = homedir()): Promise<OpenCodeConfiguration> {
  const directories = resolveOpenCodeDirectories(environment, home)
  const containerHome = OPENCODE_CONTAINER_HOME
  const setup: OpenCodeSetup = {
    copies: [],
    mappings: [{ host: resolve(workDir), container: `${containerHome}/app` }],
    configFiles: [],
    hostHome: home,
    agentsPath: `${containerHome}/.config/opencode/AGENTS.md`
  }
  const mounts: ExtraMount[] = []
  const configs: string[] = []
  const extraEnv: Record<string, string> = {}

  /** Adds an existing directory or file, leaving missing paths to OpenCode's native behavior. */
  async function addCopy(host: string, container: string, name: string, directory: boolean): Promise<void> {
    setup.mappings.push({ host, container })
    const metadata = await stat(host).catch(() => null)
    if(!metadata || (directory ? !metadata.isDirectory() : !metadata.isFile())) return
    if(directory) {
      const canonical = await realpath(host)
      if(BANNED_DIRS.has(canonical) || isWithinDirectory(home, canonical)) {
        throw new Error(`Refusing to mount broad OpenCode configuration directory: ${host}`)
      }
    }
    const source = `${containerHome}/.opencode-host/${name}`
    mounts.push([host, source, "ro"])
    setup.copies.push({ host, container, source, directory })
    if(directory) {
      configs.push(...OPENCODE_CONFIG_NAMES.map(file => join(host, file)))
    } else {
      configs.push(host)
      setup.configFiles.push(container)
    }
  }

  await addCopy(directories.config, `${containerHome}/.config/opencode`, "config", true)
  await addCopy(directories.data, `${containerHome}/.local/share/opencode`, "data", true)
  await addCopy(directories.state, `${containerHome}/.local/state/opencode`, "state", true)
  await addCopy(directories.home, `${containerHome}/.opencode`, "home", true)

  const customDirectory = environment.OPENCODE_CONFIG_DIR
  if(customDirectory) {
    const host = resolve(workDir, customDirectory.replace(/^~(?=\/)/, home))
    const existing = setup.copies.find(copy => copy.directory && copy.host === host)
    const container = existing?.container ?? `${containerHome}/.config/opencode-custom`
    if(!existing) await addCopy(host, container, "custom-dir", true)
    extraEnv.OPENCODE_CONFIG_DIR = container
    setup.agentsPath = join(container, "AGENTS.md")
  }

  for(const [key, name] of [["OPENCODE_CONFIG", "config"], ["OPENCODE_TUI_CONFIG", "tui"]]) {
    const value = environment[key]
    if(!value) continue
    const host = resolve(workDir, value.replace(/^~(?=\/)/, home))
    const providerMappings = setup.mappings.filter(mapping => mapping.container !== `${containerHome}/app`)
    const covered = providerMappings.some(mapping => isWithinDirectory(host, mapping.host))
    let container = translateOpenCodePath(host, providerMappings, home)
    if(!covered) {
      container = `${containerHome}/.config/opencode-overrides/${name}.jsonc`
      await addCopy(host, container, `override-${name}`, false)
    } else {
      configs.push(host)
      setup.configFiles.push(container)
    }
    extraEnv[key!] = container
  }

  for(const directory of [workDir, join(workDir, ".opencode")]) {
    configs.push(...OPENCODE_CONFIG_NAMES.map(name => join(directory, name)))
  }
  const contents = await Promise.all([...new Set(configs)].map(path => readFile(path, "utf-8").catch(() => "")))
  if(environment.OPENCODE_CONFIG_CONTENT) contents.push(environment.OPENCODE_CONFIG_CONTENT)
  return { setup, mounts, environment: extraEnv, configs: contents.filter(Boolean), authPath: join(directories.data, "auth.json") }
}
