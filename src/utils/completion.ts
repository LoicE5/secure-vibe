import type { ValueFlag } from "../constants"
import { FLAGS, COMPLETABLE_PROVIDER_FLAGS } from "../constants"

/**
 * Sentinel emitted to tell the shell stub to *also* offer directory completion
 * (the directory positional). Kept here so the stub generator (scripts/completion.ts)
 * imports the exact same token — no drift between the two sides.
 */
export const DIRS_DIRECTIVE = "__SV_DIRS__"

/** Resolves a flag name to its ValueFlag spec, or undefined if it isn't a value-taking flag. */
function findValueFlag(name: string | undefined): ValueFlag | undefined {
  if(!name) return undefined
  return FLAGS.find((flag): flag is ValueFlag => flag.kind === "value" && flag.name === name)
}

/**
 * Given the words typed so far, decides whether the cursor is positioned to complete
 * a value-flag's value. Handles the `--flag value` (space) form and the `--flag=value`
 * form, which bash splits on "=" into separate words by default.
 */
function activeValueFlag(words: string[]): ValueFlag | undefined {
  const count = words.length
  // `--flag = <value?>` — bash split the "=" into its own word.
  if(words.at(count - 2) === "=") return findValueFlag(words.at(count - 3))
  if(words.at(count - 1) === "=") return findValueFlag(words.at(count - 2))
  // `--flag <value>` — space form; the flag is the previous word.
  return findValueFlag(words.at(count - 2))
}

/**
 * Dynamic-completion handler invoked by the installed shell stub on every TAB
 * (`secure-vibe __complete <words…>`). Prints candidate suggestions one per line;
 * the shell stub filters them by the current partial word. All suggestions come
 * straight from the live FLAGS spec (src/constants/flags.ts), so completion never
 * goes stale as flags evolve — upgrading the tool updates completion automatically.
 */
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
