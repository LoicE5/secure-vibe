import { runSetup } from "./firewall"
import { runProxy } from "./proxy"

const subcommand = process.argv.at(2)

if(subcommand === "setup") {
  await runSetup()
} else if(subcommand === "proxy") {
  await runProxy()
} else {
  console.error("Usage: claude-mitm <setup|proxy>")
  process.exit(1)
}
