import type { ValueFlag } from "../constants"
import { FLAGS, COMPLETABLE_PROVIDER_FLAGS } from "../constants"

/** Sentinel telling the shell stub to also offer directory completion. */
export const DIRS_DIRECTIVE = "__SV_DIRS__"

/** Resolves a flag name to its ValueFlag spec, or undefined if it isn't a value-taking flag. */
function findValueFlag(name: string | undefined): ValueFlag | undefined {
  if(!name) return undefined
  return FLAGS.find((flag): flag is ValueFlag => flag.kind === "value" && flag.name === name)
}

/** Decides whether the cursor sits on a value-flag's value, in either `--flag=v` or `--flag v` form. */
function activeValueFlag(words: string[]): ValueFlag | undefined {
  const count = words.length
  if(words.at(count - 2) === "=") return findValueFlag(words.at(count - 3))
  if(words.at(count - 1) === "=") return findValueFlag(words.at(count - 2))
  return findValueFlag(words.at(count - 2))
}

/** Handles `secure-vibe __complete <words…>`, printing FLAGS-derived candidates one per line. */
export function runCompletion(words: string[]): void {
  const current = words.at(-1) ?? ""

  // 1. Completing the value of a value-flag (e.g. `--runtime <TAB>`, `--save=<TAB>`).
  //    Only its choices — no flags, no directories.
  const valueFlag = activeValueFlag(words)
  if(valueFlag) {
    for(const value of valueFlag.values ?? []) console.info(value)
    return
  }

  // 2. Flag names — when starting a flag (`-…`) OR nothing typed yet, so a bare
  //    `secure-vibe <TAB>` reveals the options too (not just after typing "--").
  if(current === "" || current.startsWith("-")) {
    for(const flag of FLAGS) console.info(flag.name)
    for(const name of COMPLETABLE_PROVIDER_FLAGS) console.info(name)
  }

  // 3. Directory positional — offer directories unless the user is clearly typing a flag.
  if(!current.startsWith("-")) console.info(DIRS_DIRECTIVE)
}
