import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { DIRS_DIRECTIVE } from "../src/utils/completion"

/**
 * Installs a dynamic shell-completion stub for the `secure-vibe` command.
 *
 * The stub holds NO flag knowledge — on each TAB it calls the live binary
 * (`bun .../src/index.ts __complete …`), which computes suggestions from the
 * FLAGS spec (src/constants/flags.ts). So completion never goes stale: upgrading
 * secure-vibe updates completion automatically, with no need to re-run setup.
 *
 * The block is written into the same aliases file the alias uses (~/.bash_aliases
 * or ~/.zsh_aliases) and is marker-guarded + idempotent — re-running replaces it.
 */

const PROJECT_DIR = join(import.meta.dir, "..")
const ENTRYPOINT = `${PROJECT_DIR}/src/index.ts`
const START = "# secure-vibe completion (start)"
const END = "# secure-vibe completion (end)"

function bashBlock(): string {
  return [
    START,
    "_secure_vibe_complete() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}" out',
    `  out="$(bun "${ENTRYPOINT}" __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)"`,
    // Strip the directory directive from the candidate list, then offer dirs too when it was present.
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
    // Ensure the completion system is initialised even if .zshrc hasn't run compinit yet.
    "(( $+functions[compdef] )) || { autoload -Uz compinit && compinit -u 2>/dev/null }",
    "_secure_vibe_complete() {",
    "  local -a out",
    `  out=( "\${(@f)$(bun "${ENTRYPOINT}" __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}" )`,
    // When the directory directive is present, drop it from the list, add the flags/values
    // (if any), then offer directories too. Otherwise just add whatever came back.
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

/** Removes any existing marker-guarded block, then appends the fresh one. */
function writeBlock(targetFile: string, block: string, rcFile: string): void {
  let content = existsSync(targetFile) ? readFileSync(targetFile, "utf8") : ""

  const startIdx = content.indexOf(START)
  if(startIdx !== -1) {
    const endIdx = content.indexOf(END, startIdx)
    if(endIdx !== -1) {
      content = content.slice(0, startIdx) + content.slice(endIdx + END.length)
    }
  }

  content = `${content.replace(/\s*$/, "")}\n\n${block}\n`.replace(/^\n+/, "")
  writeFileSync(targetFile, content)
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
