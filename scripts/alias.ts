import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { installCompletion } from "./completion"
import { bunInvocation, replaceManagedBlock } from "./shell"

const NAME = "secure-vibe"
const PROJECT_DIR = join(import.meta.dir, "..")
const ENTRYPOINT = `${PROJECT_DIR}/src/index.ts`

const START = "# secure-vibe alias (start)"
const END = "# secure-vibe alias (end)"
const LEGACY_MARKER = "# secure-vibe alias"

const FUNCTION_DEF = [
  `unalias ${NAME} 2>/dev/null || true`,
  `${NAME}() { ${bunInvocation(PROJECT_DIR, ENTRYPOINT)} "$@"; }`
].join("\n")

function block(): string {
  return [START, FUNCTION_DEF, END].join("\n")
}

/** Removes stale secure-vibe aliases without touching unrelated shell lines. */
export function stripStaleAliases(content: string): string {
  return content
    .split("\n")
    .filter(line => line.trim() !== LEGACY_MARKER && !/^\s*alias\s+secure-vibe\s*=/.test(line))
    .join("\n")
}

function addAlias(aliasFile: string, rcFile: string): void {
  let content = existsSync(aliasFile) ? readFileSync(aliasFile, "utf8") : ""
  content = stripStaleAliases(content)
  content = replaceManagedBlock(content, START, END, block())
  writeFileSync(aliasFile, content)
  console.info(`Command installed in ${aliasFile}`)
  console.info(`Run: source ${rcFile}`)
}

/** Installs the secure-vibe function and completion for the detected shell. */
export function installAlias(): void {
  const shell = process.env.SHELL ?? ""
  const home = process.env.HOME ?? ""

  if(shell.endsWith("zsh")) {
    addAlias(join(home, ".zsh_aliases"), join(home, ".zshrc"))
  } else if(shell.endsWith("bash")) {
    addAlias(join(home, ".bash_aliases"), join(home, ".bashrc"))
  } else {
    console.warn("Could not detect shell, writing to both ~/.bash_aliases and ~/.zsh_aliases")
    addAlias(join(home, ".bash_aliases"), join(home, ".bashrc"))
    addAlias(join(home, ".zsh_aliases"), join(home, ".zshrc"))
  }

  installCompletion()
}

if(import.meta.main) installAlias()
