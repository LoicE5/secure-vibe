/** Save action — zip the workdir to an archive, or copy it to a sibling directory. */
export type SaveAction = "zip" | "copy"

/** Save mode as accepted on the command line: a SaveAction, or "no" to skip. */
export type SaveMode = SaveAction | "no"

/** Options for runScrolling — the helper that streams a child process's last N lines in place. */
export interface RunScrollingOptions {
  cwd?: string
  windowSize?: number
}

/** One manifest entry recording how a file was flattened out of the workdir before the container ran. */
export interface SecretEntry {
  flatName: string
  originalRelPath: string
}
