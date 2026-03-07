import { existsSync, appendFileSync, readFileSync } from "fs"
import { join } from "path"

const ALIAS_NAME = "vibe"
const PROJECT_DIR = join(import.meta.dir, "..")
const MARKER = "# secure-vibe alias"
const ALIAS_LINE = `alias ${ALIAS_NAME}='bun run --cwd ${PROJECT_DIR} start'`

function addAlias(rcFile: string): void {
    if(existsSync(rcFile) && readFileSync(rcFile, "utf8").includes(MARKER)) {
        return console.info(`Alias already present in ${rcFile}`)
    }

    appendFileSync(rcFile, `\n${MARKER}\n${ALIAS_LINE}\n`)
    console.info(`Alias added to ${rcFile}`)
    console.info(`Reload with: source ${rcFile}`)
}

const shell = process.env.SHELL ?? ""
const home = process.env.HOME ?? ""

if(shell.endsWith("zsh")) {
    addAlias(join(home, ".zshrc"))
} else if(shell.endsWith("bash")) {
    addAlias(join(home, ".bashrc"))
} else {
    console.warn("Could not detect shell, writing to both ~/.bashrc and ~/.zshrc")
    addAlias(join(home, ".bashrc"))
    addAlias(join(home, ".zshrc"))
}
