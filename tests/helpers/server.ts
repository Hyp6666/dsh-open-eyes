import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { once } from 'node:events'

export interface MockRequest {
  method: string | undefined
  url: string | undefined
  headers: IncomingMessage['headers']
  body: unknown
}

export interface MockServer {
  origin: string
  requests: MockRequest[]
  close(): Promise<void>
}

export async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse, index: number) => void | Promise<void>,
): Promise<MockServer> {
  const requests: MockRequest[] = []
  let index = 0
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const raw = Buffer.concat(chunks).toString('utf8')
    let body: unknown = raw
    try {
      body = raw ? JSON.parse(raw) : undefined
    } catch {
      // Keep the raw body for diagnostics in tests.
    }
    requests.push({ method: request.method, url: request.url, headers: request.headers, body })
    await handler(request, response, index++)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock server did not bind a TCP port')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}

export function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}
