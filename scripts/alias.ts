import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { installCompletion } from "./completion"

const NAME = "secure-vibe"
const PROJECT_DIR = join(import.meta.dir, "..")
const ENTRYPOINT = `${PROJECT_DIR}/src/index.ts`

const START = "# secure-vibe alias (start)"
const END = "# secure-vibe alias (end)"
const LEGACY_MARKER = "# secure-vibe alias"

// A function, not an alias: zsh expands aliases before completion, which bypasses `compdef`.
// The `unalias` line clears a stale alias first, or defining the function below aborts.
const FUNCTION_DEF = [
  `unalias ${NAME} 2>/dev/null || true`,
  `${NAME}() { bun "${ENTRYPOINT}" "$@"; }`
].join("\n")

function block(): string {
  return [START, FUNCTION_DEF, END].join("\n")
}

/** Removes the current marker block and migrates away any legacy `alias` block. */
function stripBlock(content: string): string {
  const start = content.indexOf(START)
  if(start !== -1) {
    const end = content.indexOf(END, start)
    if(end !== -1) content = content.slice(0, start) + content.slice(end + END.length)
  }

  // A legacy alias block left in place would shadow the function and re-break completion.
  const lines = content.split("\n")
  const keptLines: string[] = []
  for(let index = 0; index < lines.length; index++) {
    if(lines.at(index)?.trim() === LEGACY_MARKER) {
      if(lines.at(index + 1)?.includes(NAME)) index++
      continue
    }
    keptLines.push(lines.at(index)!)
  }
  return keptLines.join("\n")
}

function addAlias(aliasFile: string, rcFile: string): void {
  let content = existsSync(aliasFile) ? readFileSync(aliasFile, "utf8") : ""
  content = stripBlock(content)
  content = `${content.replace(/\s*$/, "")}\n\n${block()}\n`.replace(/^\n+/, "")
  writeFileSync(aliasFile, content)
  console.info(`Command installed in ${aliasFile}`)
  console.info(`Run: source ${rcFile}`)
}

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
