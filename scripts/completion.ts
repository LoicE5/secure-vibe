import { join } from "path"
import { DIRS_DIRECTIVE } from "../src/utils/completion"
import { bunInvocation, writeManagedBlock } from "./shell"

const PROJECT_DIR = join(import.meta.dir, "..")
const ENTRYPOINT = `${PROJECT_DIR}/src/index.ts`
const START = "# secure-vibe completion (start)"
const END = "# secure-vibe completion (end)"
const BUN_INVOCATION = bunInvocation(PROJECT_DIR, ENTRYPOINT)

function bashBlock(): string {
  return [
    START,
    "_secure_vibe_complete() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}" out',
    `  out="$(${BUN_INVOCATION} __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)"`,
    `  COMPREPLY=( $(compgen -W "\${out//${DIRS_DIRECTIVE}/}" -- "$cur") )`,
    `  [[ "$out" == *${DIRS_DIRECTIVE}* ]] && COMPREPLY+=( $(compgen -d -- "$cur") )`,
    "}",
    "complete -F _secure_vibe_complete secure-vibe",
    END
  ].join("\n")
}

function zshBlock(): string {
  return [
    START,
    "(( $+functions[compdef] )) || { autoload -Uz compinit && compinit -u 2>/dev/null }",
    "_secure_vibe_complete() {",
    "  local -a out",
    `  out=( "\${(@f)$(${BUN_INVOCATION} __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}" )`,
    `  if (( \${out[(I)${DIRS_DIRECTIVE}]} )); then`,
    `    out=( \${out:#${DIRS_DIRECTIVE}} )`,
    "    (( ${#out} )) && compadd -- $out",
    "    _files -/",
    "  else",
    "    (( ${#out} )) && compadd -- $out",
    "  fi",
    "}",
    "compdef _secure_vibe_complete secure-vibe",
    END
  ].join("\n")
}

/** Installs one shell's completion block. */
function writeBlock(targetFile: string, block: string, rcFile: string): void {
  writeManagedBlock(targetFile, START, END, block)
  console.info(`Completion installed in ${targetFile}`)
  console.info(`Run: source ${rcFile}`)
}

/** Detects the shell and installs the appropriate completion block. */
export function installCompletion(): void {
  const shell = process.env.SHELL ?? ""
  const home = process.env.HOME ?? ""

  if(shell.endsWith("zsh")) {
    writeBlock(join(home, ".zsh_aliases"), zshBlock(), join(home, ".zshrc"))
  } else if(shell.endsWith("bash")) {
    writeBlock(join(home, ".bash_aliases"), bashBlock(), join(home, ".bashrc"))
  } else {
    console.warn("Could not detect shell, writing both ~/.bash_aliases and ~/.zsh_aliases")
    writeBlock(join(home, ".bash_aliases"), bashBlock(), join(home, ".bashrc"))
    writeBlock(join(home, ".zsh_aliases"), zshBlock(), join(home, ".zshrc"))
  }
}

if(import.meta.main) installCompletion()
