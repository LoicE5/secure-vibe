import type { ProviderId } from "../types"
import { VALID_SAVE_MODES, VALID_RUNTIMES } from "./runtime"

/**
 * Single source of truth for the CLI flag surface. Consumed by BOTH the argument
 * parser (src/utils/args.ts) and the dynamic completion handler (src/utils/completion.ts),
 * so adding a flag here updates parsing AND tab-completion at once — no drift.
 */

/** A boolean flag carries no value; its presence sets the corresponding ParsedArgs field. */
export interface BooleanFlag {
  name: string
  kind: "boolean"
  key: "build" | "buildNoCache" | "pull"
}

/** A value flag takes a value via `--flag=value` or `--flag value`. `values` lists completable choices (enums). */
export interface ValueFlag {
  name: string
  kind: "value"
  key: "save" | "runtime" | "command" | "exclude"
  values?: readonly string[]
}

export type FlagSpec = BooleanFlag | ValueFlag

export const FLAGS: readonly FlagSpec[] = [
  { name: "--build", kind: "boolean", key: "build" },
  { name: "--build-no-cache", kind: "boolean", key: "buildNoCache" },
  { name: "--pull", kind: "boolean", key: "pull" },
  { name: "--save", kind: "value", key: "save", values: VALID_SAVE_MODES },
  { name: "--runtime", kind: "value", key: "runtime", values: VALID_RUNTIMES },
  { name: "--command", kind: "value", key: "command" },
  { name: "--exclude", kind: "value", key: "exclude" }
]

/** Maps each provider-selection flag (and its aliases) to a ProviderId. */
export const PROVIDER_FLAGS: Record<string, ProviderId> = {
  "--claude": "claude",
  "--antigravity": "antigravity"
}

/**
 * Provider flags surfaced by tab-completion. Only "claude" and "antigravity" have
 * runners today (the rest are reserved), so we don't offer users non-working options.
 */
export const COMPLETABLE_PROVIDER_FLAGS: readonly string[] = ["--claude", "--antigravity"]
