import { describe, expect, it, vi } from 'vitest'
import {
  buildBridgePrompt,
  createVisionBridgeSendSession,
  type BridgeConversation,
  type BridgeCurrentModelResolver,
  type BridgeSession,
  type WebDraftUploadResponse,
  type WebImageRoutingResponse,
} from '../src/client/bridge.js'
import * as ClientPlugin from '../src/client/index.js'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

function conversation() {
  const attachment = {
    kind: 'image' as const,
    id: 'draft-1',
    previewUrl: 'blob:test',
    file: new File([png], 'clipboard.png', { type: 'image/png' }),
  }
  const value = {
    sendSession: vi.fn<BridgeConversation['sendSession']>(async () => undefined),
    draftImages: vi.fn(() => [attachment]),
    releaseDraftImages: vi.fn(),
  } satisfies BridgeConversation
  return { value, attachment }
}

function session(): BridgeSession {
  return { sessionId: 'session-1' }
}

function currentModel(
  provider = 'main-provider',
  model = 'text-model',
) {
  return vi.fn<BridgeCurrentModelResolver>(async () => ({ provider, model }))
}

function response(payload: WebDraftUploadResponse | WebImageRoutingResponse, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const bridgeRoute: WebImageRoutingResponse = {
  route: 'bridge',
  configured: true,
  defaultProvider: 'primary',
  providerIds: ['primary'],
}

const nativeRoute: WebImageRoutingResponse = {
  route: 'native',
  configured: true,
  defaultProvider: 'primary',
  providerIds: ['primary'],
}

function connection() {
  return {
    api: {
      sessions: {
        models: vi.fn(async () => ({
          result: {
            ok: true as const,
            value: { current: { provider: 'main-provider', model: 'text-model' } },
          },
        })),
      },
    },
  }
}

describe('browser conversation bridge', () => {
  it('installs on the concrete conversation service and restores the original method on unload', () => {
    const fake = conversation()
    const original = fake.value.sendSession
    let dispose: (() => void) | undefined
    ClientPlugin.apply({
      get: name => name === 'conversation' ? fake.value : name === 'connection' ? connection() : undefined,
      effect: execute => {
        dispose = execute()
        return undefined
      },
    })
    expect(ClientPlugin.inject).toEqual(['conversation', 'connection'])
    expect(fake.value.sendSession).not.toBe(original)
    dispose?.()
    expect(fake.value.sendSession).toBe(original)
  })

  it('patches the canonical Cordis service instead of a caller shadow', () => {
    const fake = conversation()
    const original = fake.value.sendSession
    const shadow = new Map<PropertyKey, unknown>()
    const traced = new Proxy(fake.value, {
      get(target, property, receiver) {
        if (property === Symbol.for('cordis.original')) return target
        return shadow.has(property) ? shadow.get(property) : Reflect.get(target, property, receiver)
      },
      set(_target, property, value) {
        shadow.set(property, value)
        return true
      },
    })
    let dispose: (() => void) | undefined

    ClientPlugin.apply({
      get: name => name === 'conversation' ? traced : name === 'connection' ? connection() : undefined,
      effect: execute => {
        dispose = execute()
        return undefined
      },
    })

    expect(fake.value.sendSession).not.toBe(original)
    expect(shadow.has('sendSession')).toBe(false)
    dispose?.()
    expect(fake.value.sendSession).toBe(original)
  })

  it('patches the prototype descriptor observed by Cordis caller shadows', () => {
    const attachment = {
      kind: 'image' as const,
      id: 'draft-1',
      previewUrl: 'blob:test',
      file: new File([png], 'clipboard.png', { type: 'image/png' }),
    }
    class ConversationService implements BridgeConversation {
      async sendSession(): Promise<void> {}
      draftImages() { return [attachment] }
      releaseDraftImages(): void {}
    }
    const root = new ConversationService()
    const owner = Object.getPrototypeOf(root) as ConversationService
    const original = owner.sendSession
    const traced = new Proxy(root, {
      get(target, property, receiver) {
        if (property === Symbol.for('cordis.original')) return target
        const value = Reflect.get(target, property, receiver) as unknown
        return typeof value === 'function' ? value.bind(receiver) : value
      },
    })
    let dispose: (() => void) | undefined

    ClientPlugin.apply({
      get: name => name === 'conversation' ? traced : name === 'connection' ? connection() : undefined,
      effect: execute => {
        dispose = execute()
        return undefined
      },
    })

    expect(owner.sendSession).not.toBe(original)
    expect(Object.hasOwn(root, 'sendSession')).toBe(false)
    dispose?.()
    expect(owner.sendSession).toBe(original)
  })

  it('passes text-only submissions through without reading model capability', async () => {
    const fake = conversation()
    const fetcher = vi.fn<typeof fetch>()
    const resolve = currentModel()
    const wrapped = createVisionBridgeSendSession(fake.value, resolve, fetcher)
    const activeSession = session()
    await wrapped(activeSession, 'hello', [], 'queue')
    expect(resolve).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(fake.value.sendSession).toHaveBeenCalledWith(activeSession, 'hello', [], 'queue')
  })

  it('preflights a declared text-only model, then sends only user text and attachment links', async () => {
    const fake = conversation()
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(bridgeRoute))
      .mockResolvedValueOnce(response({
        configured: true,
        defaultProvider: 'primary',
        providerIds: ['primary'],
        references: [reference],
      }, 201))
    const resolve = currentModel()
    const wrapped = createVisionBridgeSendSession(fake.value, resolve, fetcher)
    const activeSession = session()

    await wrapped(activeSession, 'Read the exact error code.', ['draft-1'], 'steer')

    expect(resolve).toHaveBeenCalledWith('session-1')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/vision-bridge/v1/web-image-route')
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      sessionId: 'session-1',
      provider: 'main-provider',
      model: 'text-model',
    })
    expect(fetcher.mock.calls[1]?.[0]).toBe('/vision-bridge/v1/web-drafts')
    const uploadBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(uploadBody).toEqual({
      sessionId: 'session-1',
      images: [{ name: 'clipboard.png', mediaType: 'image/png', data: Buffer.from(png).toString('base64') }],
    })
    expect(fake.value.sendSession).toHaveBeenCalledWith(
      activeSession,
      `Read the exact error code.\n\n[Attached image 1](${reference})`,
      [],
      'steer',
    )
    const forwarded = fake.value.sendSession.mock.calls[0]![1]
    expect(forwarded).not.toContain('handoff')
    expect(forwarded).not.toContain('call vision_analyze')
    expect(forwarded).not.toContain('default provider')
    expect(forwarded).not.toContain('third-party vision provider')
    expect(fake.value.releaseDraftImages).toHaveBeenCalledWith([fake.attachment])
  })

  it('uses a concrete default question and only ordinary attachment links for image-only input', () => {
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const prompt = buildBridgePrompt('', {
      configured: true,
      defaultProvider: 'primary',
      providerIds: ['primary'],
      references: [reference],
    })
    expect(prompt).toBe(`Give a concise visual overview, distinguishing visible facts from uncertain inferences.\n\n[Attached image 1](${reference})`)
  })

  it('keeps native multimodal submission entirely on the official conversation path', async () => {
    const fake = conversation()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(nativeRoute))
    const wrapped = createVisionBridgeSendSession(fake.value, currentModel('native', 'vision-model'), fetcher)
    const activeSession = session()

    await wrapped(activeSession, 'Inspect this UI.', ['draft-1'], 'queue')

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fake.value.sendSession).toHaveBeenCalledWith(activeSession, 'Inspect this UI.', ['draft-1'], 'queue')
    expect(fake.value.releaseDraftImages).not.toHaveBeenCalled()
  })

  it('rechecks the current model on every image send and never caches modality', async () => {
    const fake = conversation()
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const resolve = vi.fn<BridgeCurrentModelResolver>()
      .mockResolvedValueOnce({ provider: 'text-provider', model: 'text-model' })
      .mockResolvedValueOnce({ provider: 'native-provider', model: 'vision-model' })
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(bridgeRoute))
      .mockResolvedValueOnce(response({
        configured: true,
        defaultProvider: 'primary',
        providerIds: ['primary'],
        references: [reference],
      }, 201))
      .mockResolvedValueOnce(response(nativeRoute))
    const wrapped = createVisionBridgeSendSession(fake.value, resolve, fetcher)
    const activeSession = session()

    await wrapped(activeSession, 'first', ['draft-1'], 'queue')
    await wrapped(activeSession, 'second', ['draft-1'], 'queue')

    expect(resolve).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fake.value.sendSession.mock.calls[0]?.[1]).toContain('[Attached image 1]')
    expect(fake.value.sendSession.mock.calls[0]?.[2]).toEqual([])
    expect(fake.value.sendSession.mock.calls[1]).toEqual([activeSession, 'second', ['draft-1'], 'queue'])
  })

  it('supports repeated bridge sends in the same non-blank session without shared state', async () => {
    const fake = conversation()
    const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=9&width=1&height=1'
    const fetcher = vi.fn<typeof fetch>()
    for (let index = 0; index < 2; index += 1) {
      fetcher.mockResolvedValueOnce(response(bridgeRoute))
      fetcher.mockResolvedValueOnce(response({
        configured: true,
        defaultProvider: 'primary',
        providerIds: ['primary'],
        references: [reference],
      }, 201))
    }
    const wrapped = createVisionBridgeSendSession(fake.value, currentModel(), fetcher)
    const activeSession = session()

    await wrapped(activeSession, 'first question', ['draft-1'], 'queue')
    await wrapped(activeSession, 'follow-up question', ['draft-1'], 'queue')

    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fake.value.sendSession).toHaveBeenCalledTimes(2)
    expect(fake.value.sendSession.mock.calls[1]?.[1]).toBe(`follow-up question\n\n[Attached image 1](${reference})`)
    expect(fake.value.releaseDraftImages).toHaveBeenCalledTimes(2)
  })

  it('preserves drafts and sends no prompt when the bridge is unconfigured', async () => {
    const fake = conversation()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({
      route: 'bridge',
      configured: false,
      defaultProvider: null,
      providerIds: [],
    }))
    const wrapped = createVisionBridgeSendSession(fake.value, currentModel(), fetcher)

    await expect(wrapped(session(), 'Read this.', ['draft-1'], 'queue')).rejects.toThrow('not configured')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fake.value.sendSession).not.toHaveBeenCalled()
    expect(fake.value.releaseDraftImages).not.toHaveBeenCalled()
  })

  it('preserves drafts and sends no prompt when routing or upload fails', async () => {
    const routingFailure = conversation()
    const routingFetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"unavailable"}', { status: 503 }))
    await expect(createVisionBridgeSendSession(routingFailure.value, currentModel(), routingFetcher)(
      session(), 'x', ['draft-1'], 'queue',
    )).rejects.toThrow('image capability')
    expect(routingFailure.value.sendSession).not.toHaveBeenCalled()
    expect(routingFailure.value.releaseDraftImages).not.toHaveBeenCalled()

    const uploadFailure = conversation()
    const uploadFetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(bridgeRoute))
      .mockResolvedValueOnce(new Response('{"error":"rejected"}', { status: 413 }))
    await expect(createVisionBridgeSendSession(uploadFailure.value, currentModel(), uploadFetcher)(
      session(), 'x', ['draft-1'], 'queue',
    )).rejects.toThrow('could not accept')
    expect(uploadFailure.value.sendSession).not.toHaveBeenCalled()
    expect(uploadFailure.value.releaseDraftImages).not.toHaveBeenCalled()
  })
})
