import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MockServer } from './helpers/server.js'
import { json, startServer } from './helpers/server.js'
import { Config, validateConfig } from '../src/config.js'
import { VisionBridgeError } from '../src/errors.js'
import { createVisionTool } from '../src/tool.js'
import { TRUNCATION_MARKER, UNTRUSTED_EVIDENCE_NOTICE } from '../src/result.js'
import type { VisionAnalyzeResult } from '../src/result.js'

const servers: MockServer[] = []
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())))

function exec(signal = new AbortController().signal) {
  return { signal, agent: undefined } as unknown as ToolRunContext
}

function ctx(secret = 'test-secret') {
  const credentials = { resolve: vi.fn(async () => ({ value: secret, source: 'test' })) }
  return {
    value: {
      credentials,
      fs: { readBytes: vi.fn() },
      attachments: { validateImage: vi.fn() },
    } as unknown as Pick<Context, 'credentials' | 'fs' | 'attachments'>,
    credentials,
  }
}

async function codeOf(value: Promise<unknown>) {
  try {
    await value
  } catch (error) {
    return (error as VisionBridgeError).code
  }
}

describe('vision_analyze tool', () => {
  it('publishes the requested argument schema and a closed canonical output schema', () => {
    const tool = createVisionTool(ctx().value, validateConfig(Config({})))
    expect(tool.name).toBe('vision_analyze')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['images', 'prompt'],
      properties: {
        images: { type: 'array', items: { type: 'string' } },
        prompt: { type: 'string' },
        provider: { type: 'string' },
        detail: { type: 'string', enum: ['auto', 'low', 'high'] },
      },
    })
    expect(tool.output.schema).toMatchObject({ type: 'object', additionalProperties: false })
  })

  it('allows dormant loading but reports not configured at call time', async () => {
    const tool = createVisionTool(ctx().value, validateConfig(Config({})))
    expect(tool.description).toContain('INSTALLED BUT NOT CONFIGURED')
    expect(await codeOf(tool.execute({ images: ['a.png'], prompt: 'read it' }, exec()))).toBe('VISION_NOT_CONFIGURED')
  })

  it('advertises ready state and the configured default without requiring a probe call', () => {
    const config = validateConfig(Config({ providers: [{
      id: 'primary',
      protocol: 'openai-responses',
      baseUrl: 'https://example.test',
      model: 'vision-model',
      credential: 'VISION_API_KEY',
    }] }))
    const tool = createVisionTool(ctx().value, config)
    expect(tool.description).toContain('READY')
    expect(tool.description).toContain('default provider: primary')
    expect(tool.description).toContain('Markdown links labelled "Attached image"')
    expect(tool.description).toContain('do not expose bridge routing internals')
  })

  it('revalidates empty/too-many images, blank/long prompts, and provider selection', async () => {
    const base = validateConfig(
      Config({
        maxImages: 1,
        maxPromptChars: 3,
        providers: [
          {
            id: 'primary',
            protocol: 'openai-responses',
            baseUrl: 'https://example.test/v1',
            model: 'vision-model',
            credential: 'VISION_API_KEY',
          },
        ],
      }),
    )
    const tool = createVisionTool(ctx().value, base)
    expect(await codeOf(tool.execute({ images: [], prompt: 'ok' }, exec()))).toBe('VISION_INVALID_ARGUMENT')
    expect(await codeOf(tool.execute({ images: ['a', 'b'], prompt: 'ok' }, exec()))).toBe('VISION_INVALID_ARGUMENT')
    expect(await codeOf(tool.execute({ images: ['a'], prompt: '   ' }, exec()))).toBe('VISION_INVALID_ARGUMENT')
    expect(await codeOf(tool.execute({ images: ['a'], prompt: 'long' }, exec()))).toBe('VISION_INVALID_ARGUMENT')
    expect(await codeOf(tool.execute({ images: ['a'], prompt: 'ok', provider: 'missing' }, exec()))).toBe(
      'VISION_PROVIDER_NOT_FOUND',
    )
  })

  it('returns canonical output, resolves credentials once per call, and validates output', async () => {
    const mock = await startServer((_request, response) =>
      json(
        response,
        200,
        {
          output_text: 'The visible error is E42.',
          usage: { input_tokens: 11, output_tokens: 6, total_tokens: 17 },
          status: 'completed',
        },
        { 'x-request-id': 'request-42' },
      ),
    )
    servers.push(mock)
    const fake = ctx()
    const config = validateConfig(
      Config({
        allowRemoteUrls: true,
        providers: [
          {
            id: 'primary',
            protocol: 'openai-responses',
            baseUrl: `${mock.origin}/v1`,
            model: 'vision-model',
            credential: 'VISION_API_KEY',
          },
        ],
      }),
    )
    const tool = createVisionTool(fake.value, config)
    const value = await tool.execute(
      { images: ['https://images.example.test/a.png?sig=hidden'], prompt: 'Read the exact error.' },
      exec(),
    )
    expect(value).toEqual({
      text: 'The visible error is E42.',
      provider: 'primary',
      protocol: 'openai-responses',
      model: 'vision-model',
      image_count: 1,
      usage: { input_tokens: 11, output_tokens: 6, total_tokens: 17 },
      request_id: 'request-42',
      finish_reason: 'completed',
      truncated: false,
    })
    expect(fake.credentials.resolve).toHaveBeenCalledTimes(1)
    expect(validateJsonSchemaValue(tool.output.schema, value)).toEqual([])
  })

  it('renders an untrusted-evidence boundary and no raw image, URL, or usage JSON', () => {
    const tool = createVisionTool(ctx().value, validateConfig(Config({})))
    const value = {
      text: 'Visible text only.',
      provider: 'primary',
      protocol: 'openai-responses',
      model: 'vision-model',
      image_count: 1,
      usage: { input_tokens: 1 },
      request_id: 'req',
      finish_reason: 'stop',
      truncated: false,
    } as const
    const blocks = tool.output.render({ images: ['data:image/png;base64,SECRET'], prompt: 'x' }, value)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'text' })
    const text = (blocks[0] as { text: string }).text
    expect(text).toContain(UNTRUSTED_EVIDENCE_NOTICE)
    expect(text).toContain('Visible text only.')
    expect(text).toContain('provider=primary / protocol=openai-responses / model=vision-model / truncated=false')
    expect(text).not.toContain('data:image')
    expect(text).not.toContain('input_tokens')
    expect(text).not.toContain('request_id')
  })

  it('presents pending calls without raw paths, URL queries, or prompts', () => {
    const tool = createVisionTool(ctx().value, validateConfig(Config({})))
    const sensitiveUrl = 'https://images.example.test/a.png?signature=sensitive'
    const view = tool.presentCall?.({ images: [sensitiveUrl], prompt: 'private visual question', detail: 'high' })
    expect(view).toMatchObject({
      card: 'generic',
      kind: 'fetch',
      rawInput: { image_count: 1, provider: 'default', detail: 'high' },
    })
    expect(JSON.stringify(view)).not.toContain(sensitiveUrl)
    expect(JSON.stringify(view)).not.toContain('private visual question')
  })

  it('truncates by Unicode code point and appends a clear marker while succeeding', async () => {
    const mock = await startServer((_request, response) => json(response, 200, { output_text: 'A😀BC' }))
    servers.push(mock)
    const fake = ctx()
    const config = validateConfig(
      Config({
        allowRemoteUrls: true,
        maxOutputChars: 3,
        providers: [
          {
            id: 'primary',
            protocol: 'openai-responses',
            baseUrl: mock.origin,
            model: 'vision-model',
            credential: 'VISION_API_KEY',
          },
        ],
      }),
    )
    const value = await createVisionTool(fake.value, config).execute(
      { images: ['https://images.example.test/a.png'], prompt: 'x' },
      exec(),
    )
    expect(value).toMatchObject({ text: `A😀B${TRUNCATION_MARKER}`, truncated: true })
  })

  it('does not resolve credentials in authMode none and redacts accidental secret echoes', async () => {
    const secret = 'secret-from-store'
    const headerSecret = 'secret-from-custom-header'
    const mock = await startServer((_request, response) =>
      json(response, 400, { error: { message: `bad ${secret} and ${headerSecret}` } }),
    )
    servers.push(mock)
    const fake = ctx(secret)
    const config = validateConfig(
      Config({
        allowRemoteUrls: true,
        providers: [
          {
            id: 'primary',
            protocol: 'openai-responses',
            baseUrl: mock.origin,
            model: 'vision-model',
            credential: 'VISION_API_KEY',
            headers: { 'x-vendor-token': headerSecret },
          },
        ],
      }),
    )
    await expect(
      createVisionTool(fake.value, config).execute(
        { images: ['https://images.example.test/a.png'], prompt: 'x' },
        exec(),
      ),
    ).rejects.toSatisfy(
      (error: VisionBridgeError) => !error.message.includes(secret) && !error.message.includes(headerSecret),
    )

    const none = validateConfig(
      Config({
        allowRemoteUrls: true,
        providers: [
          {
            id: 'none',
            protocol: 'openai-responses',
            baseUrl: mock.origin,
            model: 'vision-model',
            authMode: 'none',
          },
        ],
      }),
    )
    fake.credentials.resolve.mockClear()
    await codeOf(
      createVisionTool(fake.value, none).execute(
        { images: ['https://images.example.test/a.png'], prompt: 'x' },
        exec(),
      ),
    )
    expect(fake.credentials.resolve).not.toHaveBeenCalled()
  })

  it.each([
    {
      protocol: 'openai-responses' as const,
      maxOutputTokens: undefined,
      payload: (reflected: string) => ({ output_text: reflected, id: reflected, status: reflected }),
    },
    {
      protocol: 'openai-chat-completions' as const,
      maxOutputTokens: undefined,
      payload: (reflected: string) => ({
        id: reflected,
        choices: [{ message: { content: reflected }, finish_reason: reflected }],
      }),
    },
    {
      protocol: 'anthropic-messages' as const,
      maxOutputTokens: 128,
      payload: (reflected: string) => ({ id: reflected, content: [{ type: 'text', text: reflected }], stop_reason: reflected }),
    },
  ])('redacts protected values from successful $protocol text and metadata', async ({ protocol, maxOutputTokens, payload }) => {
    const secret = 'resolved-provider-secret'
    const headerSecret = 'configured-header-secret'
    const remoteUrl = 'https://images.example.test/a.png?signature=signed-url-secret'
    const reflected = `${secret} ${headerSecret} ${remoteUrl}`
    const mock = await startServer((_request, response) => json(response, 200, payload(reflected), { 'x-request-id': reflected }))
    servers.push(mock)
    const fake = ctx(secret)
    const config = validateConfig(
      Config({
        allowRemoteUrls: true,
        providers: [
          {
            id: 'primary',
            protocol,
            baseUrl: mock.origin,
            model: 'vision-model',
            credential: 'VISION_API_KEY',
            headers: { 'x-vendor-token': headerSecret },
            ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
          },
        ],
      }),
    )
    const tool = createVisionTool(fake.value, config)
    const value = await tool.execute({ images: [remoteUrl], prompt: 'x' }, exec())
    const result = value as VisionAnalyzeResult
    const rendered = (tool.output.render({ images: [remoteUrl], prompt: 'x' }, value as never)[0] as { text: string }).text
    for (const protectedValue of [secret, headerSecret, remoteUrl, 'signed-url-secret']) {
      expect(JSON.stringify(value)).not.toContain(protectedValue)
      expect(rendered).not.toContain(protectedValue)
    }
    expect(result.text).toContain('[REDACTED]')
  })

  it('drops resolver causes at the public tool boundary', async () => {
    const fake = ctx()
    fake.credentials.resolve.mockRejectedValueOnce(new Error('internal resolver detail'))
    const config = validateConfig(
      Config({
        allowRemoteUrls: true,
        providers: [
          {
            id: 'primary',
            protocol: 'openai-responses',
            baseUrl: 'https://example.test',
            model: 'vision-model',
            credential: 'VISION_API_KEY',
          },
        ],
      }),
    )
    await expect(
      createVisionTool(fake.value, config).execute(
        { images: ['https://images.example.test/a.png'], prompt: 'x' },
        exec(),
      ),
    ).rejects.toSatisfy((error: VisionBridgeError) => error.code === 'VISION_CREDENTIAL_MISSING' && error.cause === undefined)
  })
})
