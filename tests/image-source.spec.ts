import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { prepareImage } from '../src/image-source.js'
import { encodeWebAttachmentReference } from '../src/web-draft.js'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ResolvedConfig } from '../src/config.js'
import { Config, validateConfig } from '../src/config.js'
import { VisionBridgeError } from '../src/errors.js'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { ...validateConfig(Config({})), ...overrides }
}

function exec(cwd: string | undefined = '/workspace', signal: AbortSignal = new AbortController().signal) {
  return {
    signal,
    agent: cwd === undefined ? undefined : { session: { id: 'session-1', header: { cwd } } },
  } as unknown as Pick<ToolRunContext, 'signal' | 'agent'>
}

function context(options: { outside?: boolean; type?: 'file' | 'directory' | 'other'; size?: number; validateFails?: boolean } = {}) {
  const requested = { targetKey: 'requested', displayPath: '/workspace/image.png' }
  const cwd = { targetKey: 'cwd', displayPath: '/workspace' }
  const extra = { targetKey: 'extra', displayPath: '/trusted' }
  const fs = {
    lstat: vi.fn(async () => ({ type: options.type ?? 'file', size: options.size ?? png.length, version: 'v' })),
    resolve: vi.fn(async (value: string) => (value === '/workspace' ? cwd : value === '/trusted' ? extra : requested)),
    contains: vi.fn((parent: unknown) => (parent === cwd ? !options.outside : parent === extra)),
    stat: vi.fn(async () => ({ type: options.type ?? 'file', size: options.size ?? png.length, version: 'v' })),
    readBytes: vi.fn(async () => png),
  }
  const attachments = {
    validateImage: vi.fn(async () => {
      if (options.validateFails) throw new Error('decode failed')
    }),
  }
  return { ctx: { fs, attachments } as unknown as Pick<Context, 'fs' | 'attachments'>, fs, attachments }
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise
    return undefined
  } catch (error) {
    return (error as VisionBridgeError).code
  }
}

describe('image source admission', () => {
  it('resolves relative paths from the agent session cwd and validates bytes', async () => {
    const { ctx, fs, attachments } = context()
    const image = await prepareImage(ctx, exec(), 'image.png', config())
    expect(fs.lstat).toHaveBeenCalledWith('image.png', { cwd: '/workspace' }, expect.any(AbortSignal))
    expect(fs.resolve).toHaveBeenCalledWith('image.png', { cwd: '/workspace', signal: expect.any(AbortSignal) })
    expect(fs.readBytes).toHaveBeenCalledWith(expect.anything(), expect.any(AbortSignal), 10 * 1024 * 1024)
    expect(attachments.validateImage).toHaveBeenCalledWith({ data: png, mediaType: 'image/png', name: 'image.png' })
    expect(image).toMatchObject({ kind: 'local', mediaType: 'image/png', base64: Buffer.from(png).toString('base64') })
  })

  it('treats Windows drive paths as local paths rather than URL schemes', async () => {
    const { ctx, fs } = context()
    await expect(
      prepareImage(
        ctx,
        exec('C:\\workspace'),
        'C:\\workspace\\image.png',
        config({ allowOutsideWorkspace: true }),
      ),
    ).resolves.toMatchObject({ kind: 'local', mediaType: 'image/png' })
    expect(fs.lstat).toHaveBeenCalledWith(
      'C:\\workspace\\image.png',
      { cwd: 'C:\\workspace' },
      expect.any(AbortSignal),
    )
  })

  it('rejects a local path when no agent cwd exists', async () => {
    const { ctx } = context()
    expect(await codeOf(prepareImage(ctx, exec(''), 'image.png', config()))).toBe('VISION_INVALID_ARGUMENT')
  })

  it('rejects paths outside the workspace', async () => {
    const { ctx } = context({ outside: true })
    expect(await codeOf(prepareImage(ctx, exec(), '../image.png', config()))).toBe('VISION_PATH_OUTSIDE_WORKSPACE')
  })

  it('accepts paths inside an explicitly allowed root', async () => {
    const { ctx } = context({ outside: true })
    const image = await prepareImage(ctx, exec(), '../trusted/image.png', config({ extraAllowedRoots: ['/trusted'] }))
    expect(image.kind).toBe('local')
  })

  it('rejects a final symlink before resolving it', async () => {
    const { ctx, fs } = context()
    fs.lstat.mockResolvedValueOnce({ type: 'symlink', version: 'v' } as never)
    expect(await codeOf(prepareImage(ctx, exec(), 'link.png', config()))).toBe('VISION_SYMLINK_REJECTED')
    expect(fs.resolve).not.toHaveBeenCalled()
  })

  it('rejects directories and oversized files', async () => {
    const directory = context({ type: 'directory' })
    expect(await codeOf(prepareImage(directory.ctx, exec(), 'images', config()))).toBe('VISION_INVALID_ARGUMENT')
    const oversized = context({ size: 101 })
    expect(await codeOf(prepareImage(oversized.ctx, exec(), 'large.png', config({ maxImageBytes: 100 })))).toBe(
      'VISION_IMAGE_TOO_LARGE',
    )
    expect(oversized.fs.readBytes).not.toHaveBeenCalled()
  })

  it('maps image decoder failures without leaking their raw text', async () => {
    const { ctx } = context({ validateFails: true })
    await expect(prepareImage(ctx, exec(), 'image.png', config())).rejects.toMatchObject({
      code: 'VISION_IMAGE_VALIDATION_FAILED',
      message: 'image validation failed',
    })
  })

  it('rejects remote URLs by default and passes them through unchanged when enabled', async () => {
    const { ctx, fs } = context()
    const url = 'https://images.example.test/a.png?signature=sensitive'
    expect(await codeOf(prepareImage(ctx, exec(), url, config()))).toBe('VISION_REMOTE_URL_DISABLED')
    expect(await prepareImage(ctx, exec(), url, config({ allowRemoteUrls: true }))).toEqual({ kind: 'remote', url })
    expect(fs.readBytes).not.toHaveBeenCalled()
  })

  it('rejects data URLs, file URLs, direct base64, and disallowed HTTP', async () => {
    const { ctx } = context()
    expect(await codeOf(prepareImage(ctx, exec(), 'data:image/png;base64,AAAA', config()))).toBe('VISION_INVALID_ARGUMENT')
    expect(await codeOf(prepareImage(ctx, exec(), 'file:///workspace/image.png', config()))).toBe('VISION_INVALID_ARGUMENT')
    expect(await codeOf(prepareImage(ctx, exec(), 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ', config()))).toBe(
      'VISION_INVALID_ARGUMENT',
    )
    expect(
      await codeOf(prepareImage(ctx, exec(), 'http://images.example.test/a.png', config({ allowRemoteUrls: true }))),
    ).toBe('VISION_INVALID_ARGUMENT')
  })

  it('observes caller cancellation', async () => {
    const { ctx } = context()
    const controller = new AbortController()
    controller.abort(new Error('caller canceled'))
    expect(await codeOf(prepareImage(ctx, exec('/workspace', controller.signal), 'image.png', config()))).toBe('VISION_ABORTED')
  })

  it('reads a WebUI attachment reference only in its owning session and revalidates the bytes', async () => {
    const { ctx, fs, attachments } = context()
    const ref = {
      attachmentId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      mediaType: 'image/png',
      bytes: png.byteLength,
      width: 1,
      height: 1,
      name: 'clipboard.png',
    } as ImageAttachmentRef
    const readImage = vi.fn(async () => ({ ref, data: png }))
    Object.assign(attachments, { readImage })
    const token = encodeWebAttachmentReference('session-1', ref)

    await expect(prepareImage(ctx, exec(), token, config())).resolves.toMatchObject({
      kind: 'local',
      mediaType: 'image/png',
      base64: Buffer.from(png).toString('base64'),
    })
    const { name: _name, ...stableRef } = ref
    expect(readImage).toHaveBeenCalledWith(stableRef, expect.any(AbortSignal))
    expect(attachments.validateImage).toHaveBeenCalledWith({ data: png, mediaType: 'image/png', name: 'pasted-image' })
    expect(fs.readBytes).not.toHaveBeenCalled()

    const otherSession = { ...exec(), agent: { session: { id: 'session-2', header: { cwd: '/workspace' } } } } as never
    await expect(prepareImage(ctx, otherSession, token, config())).rejects.toMatchObject({
      code: 'VISION_INVALID_ARGUMENT',
    })
  })
})
