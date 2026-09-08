import { existsSync, readFileSync, writeFileSync } from "fs"

/** Quotes one literal value for POSIX-compatible shells. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/** Builds the Bun invocation shared by the function and completion stubs. */
export function bunInvocation(projectDir: string, entrypoint: string): string {
  return `bun --no-env-file --env-file=${shellQuote(`${projectDir}/.env`)} ${shellQuote(entrypoint)}`
}

/** Replaces a marker-guarded block while preserving all unrelated content. */
export function replaceManagedBlock(content: string, start: string, end: string, block: string): string {
  let updated = content
  let startIndex = updated.indexOf(start)
  while(startIndex !== -1) {
    const endIndex = updated.indexOf(end, startIndex)
    if(endIndex === -1) break
    updated = updated.slice(0, startIndex) + updated.slice(endIndex + end.length)
    startIndex = updated.indexOf(start)
  }
  return `${updated.replace(/\s*$/, "")}\n\n${block}\n`.replace(/^\n+/, "")
}

/** Updates one managed shell block in a file. */
export function writeManagedBlock(targetFile: string, start: string, end: string, block: string): void {
  const content = existsSync(targetFile) ? readFileSync(targetFile, "utf8") : ""
  writeFileSync(targetFile, replaceManagedBlock(content, start, end, block))
}
