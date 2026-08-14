import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { isLoopbackHostname } from './config.js'
import { MAX_TOTAL_LOCAL_IMAGE_BYTES } from './config.js'
import type { ResolvedConfig } from './config.js'
import { aborted, VisionBridgeError } from './errors.js'
import { detectImageMime } from './mime.js'
import type { SupportedImageMime } from './mime.js'
import { decodeWebAttachmentReference, isWebAttachmentReference } from './web-draft.js'

export interface LocalPreparedImage {
  readonly kind: 'local'
  readonly mediaType: SupportedImageMime
  readonly base64: string
  readonly byteLength: number
}

export interface RemotePreparedImage {
  readonly kind: 'remote'
  readonly url: string
}

export type PreparedImage = LocalPreparedImage | RemotePreparedImage

type ImageContext = Pick<Context, 'fs' | 'attachments'>
type ImageExecution = Pick<ToolRunContext, 'signal' | 'agent'>

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw aborted(signal.reason)
}

function filenameOf(value: string): string {
  return value.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'image'
}

function looksLikeDirectBase64(value: string): boolean {
  const compact = value.trim()
  return compact.length >= 32 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(compact)
}

function parseRemote(value: string, config: ResolvedConfig): RemotePreparedImage | undefined {
  // A Windows drive path is a local path, not a one-letter URL scheme.
  if (/^[A-Za-z]:[\\/]/u.test(value)) return undefined
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(value)?.[1]?.toLowerCase()
  if (scheme === 'data' || scheme === 'file') {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', `${scheme}: URLs are not accepted as image arguments`)
  }
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'remote image URLs must use http or https')
  }
  if (scheme === undefined) return undefined
  if (!config.allowRemoteUrls) {
    throw new VisionBridgeError('VISION_REMOTE_URL_DISABLED', 'remote image URLs are disabled by configuration')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'remote image URL is invalid')
  }
  if (url.username || url.password) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'remote image URL must not contain embedded credentials')
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname) && !config.allowInsecureHttp) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'remote image URL uses disallowed insecure HTTP')
  }
  return { kind: 'remote', url: value }
}

function mapFsFailure(error: unknown): never {
  if (error instanceof VisionBridgeError) throw error
  if (error instanceof FsError && error.code === 'FS_TOO_LARGE') {
    throw new VisionBridgeError('VISION_IMAGE_TOO_LARGE', 'image exceeds the configured byte limit')
  }
  if (error instanceof FsError && error.code === 'FS_ABORTED') throw aborted(error)
  throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'local image could not be accessed')
}

export async function prepareImage(
  ctx: ImageContext,
  exec: ImageExecution,
  input: string,
  config: ResolvedConfig,
): Promise<PreparedImage> {
  checkAborted(exec.signal)
  if (isWebAttachmentReference(input)) {
    const sessionId = exec.agent?.session.id === undefined ? '' : String(exec.agent.session.id)
    const ref = decodeWebAttachmentReference(input, sessionId)
    if (ref.bytes > config.maxImageBytes) {
      throw new VisionBridgeError('VISION_IMAGE_TOO_LARGE', 'image exceeds the configured byte limit')
    }
    try {
      const stored = await ctx.attachments.readImage(ref, exec.signal)
      checkAborted(exec.signal)
      if (stored.data.byteLength !== ref.bytes || stored.data.byteLength > config.maxImageBytes) {
        throw new VisionBridgeError('VISION_IMAGE_VALIDATION_FAILED', 'stored WebUI image metadata does not match its bytes')
      }
      const mediaType = detectImageMime(stored.data)
      if (mediaType === undefined || mediaType !== ref.mediaType) {
        throw new VisionBridgeError('VISION_IMAGE_VALIDATION_FAILED', 'stored WebUI image media type does not match its bytes')
      }
      await ctx.attachments.validateImage({
        data: stored.data,
        mediaType,
        name: ref.name ?? 'pasted-image',
      })
      checkAborted(exec.signal)
      return {
        kind: 'local',
        mediaType,
        base64: Buffer.from(stored.data).toString('base64'),
        byteLength: stored.data.byteLength,
      }
    } catch (error) {
      checkAborted(exec.signal)
      if (error instanceof VisionBridgeError) throw error
      throw new VisionBridgeError('VISION_IMAGE_VALIDATION_FAILED', 'stored WebUI image could not be read or validated')
    }
  }
  const remote = parseRemote(input, config)
  if (remote) return remote
  if (looksLikeDirectBase64(input)) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'direct base64 image arguments are not accepted')
  }

  const cwd = exec.agent?.session.header.cwd
  if (!cwd) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'a local image path requires an agent session working directory')
  }

  try {
    const pathInfo = await ctx.fs.lstat(input, { cwd }, exec.signal)
    checkAborted(exec.signal)
    if (!pathInfo) throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'local image path does not exist')
    if (pathInfo.type === 'symlink') {
      throw new VisionBridgeError('VISION_SYMLINK_REJECTED', 'the final local image path must not be a symbolic link')
    }

    const [target, workspace] = await Promise.all([
      ctx.fs.resolve(input, { cwd, signal: exec.signal }),
      ctx.fs.resolve(cwd, { signal: exec.signal }),
    ])
    checkAborted(exec.signal)

    if (!config.allowOutsideWorkspace) {
      let allowed = ctx.fs.contains(workspace, target)
      for (const root of config.extraAllowedRoots) {
        if (allowed) break
        const resolvedRoot = await ctx.fs.resolve(root, { signal: exec.signal })
        checkAborted(exec.signal)
        allowed = ctx.fs.contains(resolvedRoot, target)
      }
      if (!allowed) {
        throw new VisionBridgeError('VISION_PATH_OUTSIDE_WORKSPACE', 'local image is outside the allowed workspace roots')
      }
    }

    const info = await ctx.fs.stat(target, exec.signal)
    checkAborted(exec.signal)
    if (!info || info.type !== 'file') {
      throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'local image must be a regular file')
    }
    if (info.size !== undefined && info.size > config.maxImageBytes) {
      throw new VisionBridgeError('VISION_IMAGE_TOO_LARGE', 'image exceeds the configured byte limit')
    }

    const bytes = await ctx.fs.readBytes(target, exec.signal, config.maxImageBytes)
    checkAborted(exec.signal)
    const mediaType = detectImageMime(bytes)
    if (!mediaType) throw new VisionBridgeError('VISION_UNSUPPORTED_IMAGE', 'image format is unsupported or malformed')
    try {
      await ctx.attachments.validateImage({ data: bytes, mediaType, name: filenameOf(input) })
    } catch {
      checkAborted(exec.signal)
      throw new VisionBridgeError('VISION_IMAGE_VALIDATION_FAILED', 'image validation failed')
    }
    checkAborted(exec.signal)
    return { kind: 'local', mediaType, base64: Buffer.from(bytes).toString('base64'), byteLength: bytes.byteLength }
  } catch (error) {
    checkAborted(exec.signal)
    return mapFsFailure(error)
  }
}

export async function prepareImages(
  ctx: ImageContext,
  exec: ImageExecution,
  inputs: readonly string[],
  config: ResolvedConfig,
): Promise<PreparedImage[]> {
  const images: PreparedImage[] = []
  let totalBytes = 0
  for (const input of inputs) {
    const image = await prepareImage(ctx, exec, input, config)
    if (image.kind === 'local') {
      totalBytes += image.byteLength
      if (totalBytes > MAX_TOTAL_LOCAL_IMAGE_BYTES) {
        throw new VisionBridgeError('VISION_IMAGE_TOO_LARGE', 'combined local images exceed the 64 MiB call limit')
      }
    }
    images.push(image)
  }
  return images
}
