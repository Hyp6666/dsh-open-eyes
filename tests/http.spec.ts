import { afterEach, describe, expect, it } from 'vitest'
import type { MockServer } from './helpers/server.js'
import { json, startServer } from './helpers/server.js'
import { postJson } from '../src/http.js'
import { VisionBridgeError } from '../src/errors.js'

const servers: MockServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

async function server(handler: Parameters<typeof startServer>[0]) {
  const value = await startServer(handler)
  servers.push(value)
  return value
}

function options(url: string, overrides: Record<string, unknown> = {}) {
  return {
    url,
    headers: { 'x-test': 'yes' },
    body: { hello: 'world' },
    signal: new AbortController().signal,
    timeoutMs: 1_000,
    maxResponseBytes: 1_024,
    maxRetries: 0,
    maxRetryDelayMs: 50,
    secrets: [] as string[],
    ...overrides,
  }
}

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise
    return undefined
  } catch (error) {
    return (error as VisionBridgeError).code
  }
}

describe('bounded HTTP JSON transport', () => {
  it('posts JSON without following redirects and returns response headers', async () => {
    const mock = await server((_request, response) => json(response, 200, { ok: true }, { 'x-request-id': 'request-1' }))
    const result = await postJson(options(`${mock.origin}/analyze`))
    expect(result.payload).toEqual({ ok: true })
    expect(result.headers.get('x-request-id')).toBe('request-1')
    expect(mock.requests[0]).toMatchObject({ method: 'POST', url: '/analyze', body: { hello: 'world' } })
    expect(mock.requests[0]?.headers['content-type']).toBe('application/json')
  })

  it('rejects redirects so authentication cannot follow them', async () => {
    const target = await server((_request, response) => json(response, 200, { shouldNotReach: true }))
    const source = await server((_request, response) => {
      response.writeHead(307, { location: `${target.origin}/target` })
      response.end()
    })
    expect(await errorCode(postJson(options(`${source.origin}/redirect`)))).toBe('VISION_UPSTREAM_PROTOCOL')
    expect(target.requests).toHaveLength(0)
  })

  it('treats non-JSON success as a protocol failure', async () => {
    const mock = await server((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('not json')
    })
    expect(await errorCode(postJson(options(mock.origin)))).toBe('VISION_UPSTREAM_PROTOCOL')
  })

  it('streams with a hard response byte cap', async () => {
    const mock = await server((_request, response) => json(response, 200, { text: 'x'.repeat(2_000) }))
    expect(await errorCode(postJson(options(mock.origin, { maxResponseBytes: 100 })))).toBe('VISION_RESPONSE_TOO_LARGE')
  })

  it('returns bounded redacted summaries for non-2xx responses', async () => {
    const secret = 'super-secret-key'
    const mock = await server((_request, response) =>
      json(response, 401, { error: { message: `bad key ${secret} at https://example.test/a?token=${secret}` } }),
    )
    await expect(postJson(options(mock.origin, { secrets: [secret] }))).rejects.toSatisfy((error: VisionBridgeError) => {
      expect(error.code).toBe('VISION_UPSTREAM_HTTP')
      expect(error.message).not.toContain(secret)
      expect(error.message).toContain('[REDACTED]')
      return true
    })
  })

  it('forces exactly one JSON content type even when a caller supplies different casing', async () => {
    const mock = await server((_request, response) => json(response, 200, { ok: true }))
    await postJson(options(mock.origin, { headers: { 'Content-Type': 'text/plain' } }))
    expect(mock.requests[0]?.headers['content-type']).toBe('application/json')
  })

  it('retries only retryable HTTP statuses and caps Retry-After', async () => {
    const mock = await server((_request, response, index) => {
      if (index === 0) return json(response, 429, { error: 'busy' }, { 'retry-after': '30' })
      return json(response, 200, { ok: true })
    })
    const started = Date.now()
    await expect(postJson(options(mock.origin, { maxRetries: 1, maxRetryDelayMs: 20 }))).resolves.toMatchObject({
      payload: { ok: true },
    })
    expect(mock.requests).toHaveLength(2)
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('does not retry terminal 4xx errors', async () => {
    const mock = await server((_request, response) => json(response, 400, { error: 'bad request' }))
    expect(await errorCode(postJson(options(mock.origin, { maxRetries: 2 })))).toBe('VISION_UPSTREAM_HTTP')
    expect(mock.requests).toHaveLength(1)
  })

  it('retries a transient socket failure before any response', async () => {
    const mock = await server((request, response, index) => {
      if (index === 0) {
        request.socket.destroy()
        return
      }
      return json(response, 200, { recovered: true })
    })
    await expect(postJson(options(mock.origin, { maxRetries: 1 }))).resolves.toMatchObject({ payload: { recovered: true } })
    expect(mock.requests).toHaveLength(2)
  })

  it('classifies timeout and caller abort separately', async () => {
    const mock = await server(() => undefined)
    expect(await errorCode(postJson(options(mock.origin, { timeoutMs: 20 })))).toBe('VISION_TIMEOUT')

    const controller = new AbortController()
    const pending = postJson(options(mock.origin, { signal: controller.signal, timeoutMs: 1_000 }))
    controller.abort(new Error('user canceled'))
    expect(await errorCode(pending)).toBe('VISION_ABORTED')
  })
})
