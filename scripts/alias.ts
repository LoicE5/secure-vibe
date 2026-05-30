import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { installCompletion } from "./completion"

const NAME = "secure-vibe"
const PROJECT_DIR = join(import.meta.dir, "..")
const ENTRYPOINT = `${PROJECT_DIR}/src/index.ts`

const START = "# secure-vibe alias (start)"
const END = "# secure-vibe alias (end)"
const LEGACY_MARKER = "# secure-vibe alias"

// A shell FUNCTION, not an alias: zsh expands aliases before attempting completion,
// which bypasses the `compdef secure-vibe` registration and breaks tab-completion.
// A function isn't expanded that way, behaves identically for the user, and works
// in both bash and zsh.
//
// The leading `unalias` drops any stale alias of the same name first (e.g. one left
// active in the current shell from a previous setup). Without it, zsh/bash expand the
// alias while parsing the function line below and abort with
// "defining function based on alias". It runs on its own line so the removal takes
// effect before the next line is parsed.
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

  // Drop a legacy "# secure-vibe alias\nalias secure-vibe=…" block — left in place,
  // the alias would shadow the new function in zsh and re-break completion.
  const lines = content.split("\n")
  const kept: string[] = []
  for(let i = 0; i < lines.length; i++) {
    if(lines[i]?.trim() === LEGACY_MARKER) {
      if(lines[i + 1]?.includes(NAME)) i++
      continue
    }
    kept.push(lines[i]!)
  }
  return kept.join("\n")
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

// Also install dynamic shell completion so `setup:alias` wires up both in one step.
installCompletion()
