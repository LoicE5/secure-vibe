import { dirname, basename, join } from "path"
import type { RunScrollingOptions, SaveAction } from "../types"
import { timestamp } from "./fs"

/** Runs a child process, streaming the last `windowSize` lines in place when on a TTY. */
async function runScrolling(args: string[], opts: RunScrollingOptions = {}): Promise<number> {
  const { cwd, windowSize = 5 } = opts

  if(!process.stdout.isTTY) {
    const directProc = Bun.spawn(args, { cwd, stdout: "inherit", stderr: "inherit" })
    return directProc.exited
  }

  const childProc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" })
  const buffer: string[] = []
  let linesWritten = 0
  const cols = process.stdout.columns ?? 80

  const emit = (line: string): void => {
    const trimmed = line.trimEnd().slice(0, cols - 2)
    if(!trimmed) return
    buffer.push(trimmed)
    if(buffer.length > windowSize) buffer.shift()
    if(linesWritten > 0) process.stdout.write(`\x1b[${linesWritten}A`)
    process.stdout.write(buffer.map(line => `\x1b[2K  ${line}`).join("\n") + "\n")
    linesWritten = buffer.length
  }

  const consume = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder()
    let partial = ""
    for await(const chunk of stream) {
      const text = partial + decoder.decode(chunk, { stream: true })
      const parts = text.split(/[\n\r]/)
      partial = parts.pop() ?? ""
      for(const part of parts) emit(part)
    }
    if(partial) emit(partial)
  }

  await Promise.all([consume(childProc.stdout), consume(childProc.stderr)])
  return childProc.exited
}

/** Backs up `workDir` next to itself as a .zip or an rsync copy. Errors are logged, not thrown. */
export async function saveDirectory(workDir: string, mode: SaveAction): Promise<void> {
  const parent = dirname(workDir)
  const name = basename(workDir)
  const destination = mode === "zip"
    ? join(parent, `${name}-${timestamp()}.zip`)
    : join(parent, `${name}-${timestamp()}`)

  try {
    if(mode === "zip") {
      console.info(`  Zipping "${name}" to ${destination} ...`)
      const exitCode = await runScrolling(["zip", "-r", destination, "."], { cwd: workDir })
      if(exitCode !== 0) {
        console.error(`  ✗ zip failed (exit ${exitCode}).`)
        return
      }
    } else {
      console.info(`  Copying "${name}" to ${destination} ...`)
      const exitCode = await runScrolling(["rsync", "-avh", "--progress", workDir, destination])
      if(exitCode !== 0) {
        console.error(`  ✗ rsync failed (exit ${exitCode}).`)
        return
      }
    }

    console.info(`  Saved to: ${destination}`)
  } catch(saveError: unknown) {
    console.error("  ✗ Save failed:", saveError)
  }
}
