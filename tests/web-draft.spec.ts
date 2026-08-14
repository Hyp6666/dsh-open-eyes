import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Config, validateConfig } from '../src/config.js'
import {
  WEB_ATTACHMENT_ENDPOINT,
  WEB_DRAFT_ENDPOINT,
  WEB_IMAGE_ROUTE_ENDPOINT,
  createWebAttachmentHandler,
  createWebDraftHandler,
  createWebImageRouteHandler,
  decodeWebAttachmentReference,
} from '../src/web-draft.js'

const png = readFileSync(new URL('../fixtures/tiny.png', import.meta.url))
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections()
    server.close()
    await once(server, 'close')
  }))
})

function resolved(configured = true) {
  return validateConfig(Config(configured
    ? {
        providers: [{
          id: 'primary',
          protocol: 'openai-responses',
          baseUrl: 'https://vision.example.test/v1',
          model: 'vision-model',
          credential: 'VISION_API_KEY',
        }],
      }
    : {}))
}

async function serve(handler: ReturnType<typeof createWebDraftHandler>): Promise<string> {
  const server = createServer((request, response) => {
    void handler(request, response)
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind')
  return `http://127.0.0.1:${address.port}`
}

function attachmentRef(index = 0): ImageAttachmentRef {
  return {
    attachmentId: `sha256:${String(index).padStart(64, 'a')}` as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: png.byteLength,
    width: 1,
    height: 1,
    name: 'clipboard.png',
  }
}

function fakeAttachments() {
  const validateImage = vi.fn(async () => undefined)
  const saveImage = vi.fn(async () => attachmentRef())
  const readImage = vi.fn(async (ref: ImageAttachmentRef) => ({ ref, data: new Uint8Array(png) }))
  return { validateImage, saveImage, readImage }
}

async function post(
  origin: string,
  body: unknown,
  headers: Record<string, string> = {},
  endpoint = WEB_DRAFT_ENDPOINT,
) {
  return fetch(`${origin}${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...headers,
    },
    body: JSON.stringify(body),
    redirect: 'error',
  })
}

describe('WebUI pasted-image draft admission', () => {
  it('serves a bridge thumbnail only when the exact token is in its direct user session log', async () => {
    const attachments = fakeAttachments()
    const { name: _name, ...stableRef } = attachmentRef()
    const reference = `vision-bridge://attachment/v1/session-1/${encodeURIComponent(String(stableRef.attachmentId))}?media=image%2Fpng&bytes=${stableRef.bytes}&width=1&height=1`
    const session = {
      events: [{
        type: 'user/message',
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: `Inspect this.\n\n[Attached image 1](${reference})` }],
        },
      }],
    }
    const origin = await serve(createWebAttachmentHandler({
      attachments,
      session: id => id === 'session-1' ? session : undefined,
    }))

    const response = await post(origin, { reference }, {}, WEB_ATTACHMENT_ENDPOINT)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(png))
    expect(attachments.readImage).toHaveBeenCalledWith(stableRef)
  })

  it('rejects a stored image that is not referenced by the owning direct user turn', async () => {
    const attachments = fakeAttachments()
    const { name: _name, ...stableRef } = attachmentRef()
    const reference = `vision-bridge://attachment/v1/session-1/${encodeURIComponent(String(stableRef.attachmentId))}?media=image%2Fpng&bytes=${stableRef.bytes}&width=1&height=1`
    const origin = await serve(createWebAttachmentHandler({
      attachments,
      session: () => ({ events: [] }),
    }))
    const response = await post(origin, { reference }, {}, WEB_ATTACHMENT_ENDPOINT)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'VISION_WEB_ATTACHMENT_NOT_REFERENCED' })
    expect(attachments.readImage).not.toHaveBeenCalled()
  })

  it('routes declared text-only models to the bridge without admitting a prompt', async () => {
    const resolveModelInfo = vi.fn(async () => ({ inputModalities: ['text'] }))
    const origin = await serve(createWebImageRouteHandler({
      hasSession: id => id === 'session-1',
      resolveModelInfo,
      config: resolved(),
    }))
    const response = await post(origin, {
      sessionId: 'session-1',
      provider: 'main-provider',
      model: 'text-model',
    }, {}, WEB_IMAGE_ROUTE_ENDPOINT)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      route: 'bridge',
      configured: true,
      defaultProvider: 'primary',
      providerIds: ['primary'],
    })
    expect(resolveModelInfo).toHaveBeenCalledWith('main-provider', 'text-model')
  })

  it('routes image-capable and unknown-capability models through native DSH on every request', async () => {
    const resolveModelInfo = vi.fn()
      .mockResolvedValueOnce({ inputModalities: ['text', 'image'] })
      .mockResolvedValueOnce({})
    const origin = await serve(createWebImageRouteHandler({
      hasSession: () => true,
      resolveModelInfo,
      config: resolved(false),
    }))
    const body = { sessionId: 'session-1', provider: 'main-provider', model: 'switchable-model' }

    const declared = await post(origin, body, {}, WEB_IMAGE_ROUTE_ENDPOINT)
    const unknown = await post(origin, body, {}, WEB_IMAGE_ROUTE_ENDPOINT)

    expect((await declared.json() as { route: string }).route).toBe('native')
    expect((await unknown.json() as { route: string }).route).toBe('native')
    expect(resolveModelInfo).toHaveBeenCalledTimes(2)
  })

  it('rejects unknown sessions and fails closed when model capability cannot be resolved', async () => {
    const unknownSession = await serve(createWebImageRouteHandler({
      hasSession: () => false,
      resolveModelInfo: vi.fn(),
      config: resolved(),
    }))
    const body = { sessionId: 'missing', provider: 'main-provider', model: 'text-model' }
    expect((await post(unknownSession, body, {}, WEB_IMAGE_ROUTE_ENDPOINT)).status).toBe(404)

    const unavailable = await serve(createWebImageRouteHandler({
      hasSession: () => true,
      resolveModelInfo: vi.fn(async () => { throw new Error('provider leaked error') }),
      config: resolved(),
    }))
    const response = await post(unavailable, { ...body, sessionId: 'session-1' }, {}, WEB_IMAGE_ROUTE_ENDPOINT)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'VISION_WEB_MODEL_CAPABILITY_UNAVAILABLE' })
  })

  it('validates then durably saves a same-origin image and returns a session-bound reference', async () => {
    const attachments = fakeAttachments()
    const handler = createWebDraftHandler({
      attachments,
      hasSession: id => id === 'session-1',
      config: resolved(),
    })
    const origin = await serve(handler)
    const response = await post(origin, {
      sessionId: 'session-1',
      images: [{ name: 'clipboard.png', mediaType: 'image/png', data: png.toString('base64') }],
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = await response.json() as {
      configured: boolean
      defaultProvider: string | null
      providerIds: string[]
      references: string[]
    }
    expect(payload).toMatchObject({
      configured: true,
      defaultProvider: 'primary',
      providerIds: ['primary'],
    })
    expect(payload.references).toHaveLength(1)
    const { name: _name, ...stableRef } = attachmentRef()
    expect(decodeWebAttachmentReference(payload.references[0]!, 'session-1')).toEqual(stableRef)
    expect(attachments.validateImage).toHaveBeenCalledWith({
      data: new Uint8Array(png),
      mediaType: 'image/png',
      name: 'clipboard.png',
    })
    expect(attachments.saveImage).toHaveBeenCalledAfter(attachments.validateImage)
  })

  it('reports installed-but-unconfigured without persisting the browser draft', async () => {
    const attachments = fakeAttachments()
    const origin = await serve(createWebDraftHandler({
      attachments,
      hasSession: () => true,
      config: resolved(false),
    }))
    const response = await post(origin, {
      sessionId: 'session-1',
      images: [{ name: 'clipboard.png', mediaType: 'image/png', data: png.toString('base64') }],
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      configured: false,
      defaultProvider: null,
      providerIds: [],
      references: [],
    })
    expect(attachments.saveImage).not.toHaveBeenCalled()
  })

  it('rejects cross-origin, unknown-session, malformed base64, MIME spoofing, and oversized input', async () => {
    const attachments = fakeAttachments()
    const config = { ...resolved(), maxImageBytes: png.byteLength - 1 }
    const origin = await serve(createWebDraftHandler({ attachments, hasSession: () => false, config }))
    const validBody = {
      sessionId: 'missing',
      images: [{ name: '../private.png', mediaType: 'image/png', data: png.toString('base64') }],
    }

    expect((await post(origin, validBody, { origin: 'https://attacker.example' })).status).toBe(403)
    expect((await post(origin, validBody)).status).toBe(404)

    const knownOrigin = await serve(createWebDraftHandler({ attachments, hasSession: () => true, config: resolved() }))
    expect((await post(knownOrigin, {
      sessionId: 'session-1',
      images: [{ name: 'x.png', mediaType: 'image/png', data: 'not-base64!' }],
    })).status).toBe(400)
    expect((await post(knownOrigin, {
      sessionId: 'session-1',
      images: [{ name: 'x.jpg', mediaType: 'image/jpeg', data: png.toString('base64') }],
    })).status).toBe(415)

    const smallOrigin = await serve(createWebDraftHandler({ attachments, hasSession: () => true, config }))
    expect((await post(smallOrigin, validBody)).status).toBe(413)
    expect(attachments.saveImage).not.toHaveBeenCalled()
  })

  it('rejects non-POST and non-JSON requests without enabling CORS', async () => {
    const origin = await serve(createWebDraftHandler({
      attachments: fakeAttachments(),
      hasSession: () => true,
      config: resolved(),
    }))
    const get = await fetch(`${origin}${WEB_DRAFT_ENDPOINT}`)
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    const text = await fetch(`${origin}${WEB_DRAFT_ENDPOINT}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'text/plain' },
      body: 'x',
    })
    expect(text.status).toBe(415)
    expect(text.headers.get('access-control-allow-origin')).toBeNull()
  })
})
