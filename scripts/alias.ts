import { existsSync, appendFileSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

const ALIAS_NAME = "secure-vibe"
const PROJECT_DIR = join(import.meta.dir, "..")
const MARKER = "# secure-vibe alias"
const ALIAS_LINE = `alias ${ALIAS_NAME}='bun run --cwd ${PROJECT_DIR} start'`

function addAlias(aliasFile: string, rcFile: string): void {
    if(!existsSync(aliasFile)) {
        writeFileSync(aliasFile, "")
        console.info(`Created ${aliasFile}`)
    }

    if(readFileSync(aliasFile, "utf8").includes(MARKER)) {
        return console.info(`Alias already present in ${aliasFile}`)
    }

    appendFileSync(aliasFile, `\n${MARKER}\n${ALIAS_LINE}\n`)
    console.info(`Alias added to ${aliasFile}`)
    console.info(`Run: source ${rcFile}`)
}

const shell = process.env.SHELL ?? ""
const home = process.env.HOME ?? ""

if(shell.endsWith("zsh")) {
    addAlias(join(home, ".zsh_aliases"), join(home, ".zshrc"))
} else if(shell.endsWith("bash")) {
    addAlias(join(home, ".bash_aliases"), join(home, ".bashrc"))
} else {
    console.warn("Could not detect shell, writing to both ~/.bash_aliases and ~/.zsh_aliases")
    addAlias(join(home, ".bash_aliases"), join(home, ".bashrc"))
    addAlias(join(home, ".zsh_aliases"), join(home, ".zshrc"))
}
