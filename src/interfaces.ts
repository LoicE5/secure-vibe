export type Runtime = "docker" | "podman"
export type SaveAction = "zip" | "copy"
export type SaveMode = SaveAction | "no"

export interface ParsedArgs {
  directory: string | null
  save: string | null
  runtime: string | null
  command: string | null
  exclude: string | null
  build: boolean
  buildNoCache: boolean
  pull: boolean
}

export interface GitIdentity {
  name: string
  email: string
}

export interface RunScrollingOptions {
  cwd?: string
  windowSize?: number
}

export interface SecretEntry {
  flatName: string
  originalRelPath: string
}
