const NODE_REPL_HEADER = /^\[mcp_servers\.(?:node_repl|"node_repl")\]\s*$/m
const MACOS_CHATGPT_COMMAND = /^command\s*=\s*["']\/Applications\/ChatGPT\.app\//m

/** Disables ChatGPT's macOS-only node_repl in the ephemeral Linux config copy. */
export function disableMacosNodeRepl(config: string): string {
  const header = NODE_REPL_HEADER.exec(config)
  if(!header || header.index === undefined) return config

  const sectionStart = header.index
  const headerEnd = sectionStart + header[0].length
  const remaining = config.slice(headerEnd)
  const nextHeaderOffset = remaining.search(/^\[/m)
  const sectionEnd = nextHeaderOffset === -1 ? config.length : headerEnd + nextHeaderOffset
  const section = config.slice(sectionStart, sectionEnd)

  if(!MACOS_CHATGPT_COMMAND.test(section)) return config

  const disabledSection = /^enabled\s*=\s*(?:true|false)\s*$/m.test(section)
    ? section.replace(/^enabled\s*=\s*(?:true|false)\s*$/m, "enabled = false")
    : section.replace(header[0], `${header[0]}\nenabled = false`)

  return config.slice(0, sectionStart) + disabledSection + config.slice(sectionEnd)
}
