export type Runtime = "docker" | "podman"
export type SaveMode = "zip" | "copy" | "no"

export interface ParsedArgs {
  directory: string | null
  save: string | null
  runtime: string | null
  command: string | null
  exclude: string | null
  build: boolean
  buildNoCache: boolean
}
