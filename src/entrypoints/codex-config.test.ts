import { describe, expect, test } from "bun:test"
import { disableMacosNodeRepl } from "./codex-config"

describe("Codex config sanitization", () => {
  test("disables the node_repl bundled with the macOS ChatGPT app", () => {
    const config = [
      "[mcp_servers.node_repl]",
      "args = []",
      'command = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"',
      "startup_timeout_sec = 120",
      "",
      "[mcp_servers.node_repl.env]",
      'CODEX_HOME = "/Users/example/.codex"'
    ].join("\n")

    expect(disableMacosNodeRepl(config)).toBe([
      "[mcp_servers.node_repl]",
      "enabled = false",
      "args = []",
      'command = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"',
      "startup_timeout_sec = 120",
      "",
      "[mcp_servers.node_repl.env]",
      'CODEX_HOME = "/Users/example/.codex"'
    ].join("\n"))
  })

  test("overrides an explicitly enabled macOS node_repl and is idempotent", () => {
    const config = [
      '[mcp_servers."node_repl"]',
      "enabled = true",
      'command = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl"'
    ].join("\n")
    const sanitized = disableMacosNodeRepl(config)

    expect(sanitized).toContain("enabled = false")
    expect(disableMacosNodeRepl(sanitized)).toBe(sanitized)
  })

  test("preserves portable and unrelated MCP servers", () => {
    const portable = [
      "[mcp_servers.node_repl]",
      'command = "npx"',
      'args = ["-y", "node-repl-mcp"]',
      "",
      "[mcp_servers.context7]",
      'command = "npx"'
    ].join("\n")

    expect(disableMacosNodeRepl(portable)).toBe(portable)
  })
})
