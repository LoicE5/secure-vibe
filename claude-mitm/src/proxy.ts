import { Proxy } from "http-mitm-proxy"
import net from "net"
import { API_ALLOWLIST, PASS_THROUGH_HOSTS, READ_METHODS } from "./rules"

const CA_DIR = "/home/mitm/.mitmproxy"

function isHostApiAllowlisted(hostname: string): boolean {
  for(const allowed of API_ALLOWLIST) {
    if(hostname === allowed || hostname.endsWith(`.${allowed}`)) return true
  }
  return false
}

export async function runProxy(): Promise<void> {
  const proxy = new Proxy()

  // CONNECT pass-through for Anthropic domains — no TLS interception.
  // Client handles TLS against the real Anthropic certificate directly,
  // which is required for Claude CLI to authenticate correctly.
  proxy.onConnect((req, socket, head, callback) => {
    const hostname = (req.url ?? "").split(":").at(0) ?? ""
    if(PASS_THROUGH_HOSTS.has(hostname)) {
      const port = parseInt((req.url ?? "").split(":").at(1) ?? "443") || 443
      const upstream = net.connect(port, hostname, () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        upstream.pipe(socket)
        socket.pipe(upstream)
      })
      upstream.on("error", (error: Error) => {
        console.error(`[proxy] Pass-through error ${hostname}: ${error.message}`)
        socket.destroy()
      })
      return  // do NOT call callback — we handled this connection ourselves
    }
    callback()  // library handles TLS MITM for all other HTTPS
  })

  // GET-only enforcement for HTTP and intercepted HTTPS traffic
  proxy.onRequest((ctx, callback) => {
    const method = (ctx.clientToProxyRequest.method ?? "").toUpperCase()
    const hostname = ctx.clientToProxyRequest.headers.host ?? ""

    if(!READ_METHODS.has(method) && !isHostApiAllowlisted(hostname)) {
      const body = `[secure-vibe] Blocked: ${method} ${hostname} — non-GET requests are only allowed to approved API endpoints.\n`
      ctx.proxyToClientResponse.writeHead(403, {
        "Content-Type": "text/plain",
        "Content-Length": String(Buffer.byteLength(body)),
        "Connection": "close"
      })
      ctx.proxyToClientResponse.end(body)
      return
    }
    callback()
  })

  proxy.onError((ctx, error: Error) => {
    const host = ctx?.clientToProxyRequest?.headers?.host ?? "unknown"
    console.error(`[proxy] Error for ${host}: ${error.message}`)
  })

  await new Promise<void>((resolve, reject) => {
    proxy.listen({ host: "127.0.0.1", port: 8080, sslCaDir: CA_DIR }, (error?: Error) => {
      if(error) { reject(error); return }
      console.info("[proxy] Listening on 127.0.0.1:8080")
      resolve()
    })
  })

  // Keep process alive
  await new Promise<never>(() => {})
}
