import type { ProviderId } from "../types"
import { VALID_SAVE_MODES, VALID_RUNTIMES } from "./runtime"

/** Single source of truth for the CLI flag surface: drives both parsing and tab-completion. */

/** A boolean flag carries no value; its presence sets the corresponding ParsedArgs field. */
export interface BooleanFlag {
  name: string
  kind: "boolean"
  key: "build" | "buildNoCache" | "pull" | "local"
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
  { name: "--local", kind: "boolean", key: "local" },
  { name: "--save", kind: "value", key: "save", values: VALID_SAVE_MODES },
  { name: "--runtime", kind: "value", key: "runtime", values: VALID_RUNTIMES },
  { name: "--command", kind: "value", key: "command" },
  { name: "--exclude", kind: "value", key: "exclude" }
]

/** Maps each provider-selection flag (and its aliases) to a ProviderId. */
export const PROVIDER_FLAGS: Record<string, ProviderId> = {
  "--claude": "claude",
  "--antigravity": "antigravity",
  "--agy": "antigravity",
  "--ccr": "ccr",
  "--claude-code-router": "ccr",
  "--codex": "codex",
  "--gpt": "codex",
  "--vibe": "vibe",
  "--lechat": "vibe",
  "--mistral": "vibe",
  "--miaou": "vibe"
}

/** Provider flags surfaced by tab-completion — only those with a runner today. */
export const COMPLETABLE_PROVIDER_FLAGS: readonly string[] = [
  "--claude", "--antigravity", "--agy", "--ccr", "--claude-code-router", "--codex", "--gpt",
  "--vibe", "--lechat", "--mistral", "--miaou"
]
