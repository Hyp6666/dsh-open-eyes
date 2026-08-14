import type { IncomingMessage, ServerResponse } from 'node:http'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ResolvedConfig } from './config.js'
import { MAX_TOTAL_LOCAL_IMAGE_BYTES } from './config.js'
import { takeCodePoints, VisionBridgeError } from './errors.js'
import { detectImageMime } from './mime.js'

export { WEB_ATTACHMENT_ENDPOINT, WEB_DRAFT_ENDPOINT, WEB_IMAGE_ROUTE_ENDPOINT } from './web-contract.js'
const WEB_REFERENCE_PREFIX = 'vision-bridge://attachment/v1/'
const MAX_SESSION_ID_CHARS = 512
const MAX_ATTACHMENT_ID_CHARS = 1_024
const MAX_FILE_NAME_CHARS = 255
const MAX_MODEL_ID_CHARS = 1_024
const REQUEST_OVERHEAD_BYTES = 64 * 1024

type AttachmentWriter = {
  validateImage(input: SaveImageAttachment): Promise<void>
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
}

type AttachmentReader = {
  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<{
    readonly ref: ImageAttachmentRef
    readonly data: Uint8Array
  }>
}

type SessionEventSource = {
  readonly events: readonly unknown[]
}

export interface WebDraftHandlerOptions {
  readonly attachments: AttachmentWriter
  readonly hasSession: (sessionId: string) => boolean
  readonly config: ResolvedConfig
}

export interface WebImageRouteHandlerOptions {
  readonly hasSession: (sessionId: string) => boolean
  readonly resolveModelInfo: (
    provider: string,
    model: string,
  ) => Promise<{ readonly inputModalities?: readonly string[] }>
  readonly config: ResolvedConfig
}

export interface WebAttachmentHandlerOptions {
  readonly attachments: AttachmentReader
  readonly session: (sessionId: string) => SessionEventSource | undefined
}

interface BrowserImageInput {
  readonly name: string
  readonly mediaType: ImageMediaType
  readonly data: string
}

class WebDraftHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
    this.name = 'WebDraftHttpError'
  }
}

function httpError(status: number, code: string): never {
  throw new WebDraftHttpError(status, code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positiveInteger(value: string | null, field: string): number {
  if (value === null || !/^[1-9][0-9]*$/u.test(value)) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', `invalid WebUI attachment ${field}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', `invalid WebUI attachment ${field}`)
  }
  return parsed
}

function oneParam(url: URL, key: string, required = true): string | undefined {
  const values = url.searchParams.getAll(key)
  if (values.length > 1 || (required && values.length !== 1)) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'malformed WebUI attachment reference')
  }
  return values[0]
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'malformed WebUI attachment reference')
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}

/** Serialize only DSH attachment metadata. Image bytes and credentials never enter the tool argument. */
export function encodeWebAttachmentReference(sessionId: string, ref: ImageAttachmentRef): string {
  if (!sessionId || takeCodePoints(sessionId, MAX_SESSION_ID_CHARS).truncated) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'invalid WebUI attachment session')
  }
  const attachmentId = String(ref.attachmentId)
  if (!attachmentId || takeCodePoints(attachmentId, MAX_ATTACHMENT_ID_CHARS).truncated) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'invalid WebUI attachment id')
  }
  const params = new URLSearchParams({
    media: ref.mediaType,
    bytes: String(ref.bytes),
    width: String(ref.width),
    height: String(ref.height),
  })
  // Deliberately omit the display name: the token stays content/metadata stable
  // when the same bytes arrive under a different clipboard filename.
  return `${WEB_REFERENCE_PREFIX}${encodeURIComponent(sessionId)}/${encodeURIComponent(attachmentId)}?${params.toString()}`
}

export function isWebAttachmentReference(value: string): boolean {
  return value.startsWith(WEB_REFERENCE_PREFIX)
}

interface ParsedWebAttachmentReference {
  readonly sessionId: string
  readonly ref: ImageAttachmentRef
}

/** Parse one bridge-owned attachment token without granting access to its bytes. */
function parseWebAttachmentReference(value: string): ParsedWebAttachmentReference {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'malformed WebUI attachment reference')
  }
  if (
    url.protocol !== 'vision-bridge:'
    || url.hostname !== 'attachment'
    || url.username
    || url.password
    || url.port
    || url.hash
  ) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'malformed WebUI attachment reference')
  }
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 3 || segments[0] !== 'v1') {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'malformed WebUI attachment reference')
  }
  const sessionId = decodePathSegment(segments[1]!)
  const attachmentId = decodePathSegment(segments[2]!)
  if (!sessionId || takeCodePoints(sessionId, MAX_SESSION_ID_CHARS).truncated) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'invalid WebUI attachment session')
  }
  if (!attachmentId || takeCodePoints(attachmentId, MAX_ATTACHMENT_ID_CHARS).truncated) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'invalid WebUI attachment id')
  }
  const allowed = new Set(['media', 'bytes', 'width', 'height', 'name'])
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'malformed WebUI attachment reference')
  }
  const mediaType = oneParam(url, 'media')
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'invalid WebUI attachment media type')
  }
  const bytes = positiveInteger(oneParam(url, 'bytes') ?? null, 'byte length')
  const width = positiveInteger(oneParam(url, 'width') ?? null, 'width')
  const height = positiveInteger(oneParam(url, 'height') ?? null, 'height')
  const name = oneParam(url, 'name', false)
  if (name !== undefined && (!name || takeCodePoints(name, MAX_FILE_NAME_CHARS).truncated || hasControlCharacters(name))) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'invalid WebUI attachment name')
  }
  return {
    sessionId,
    ref: {
      attachmentId: AttachmentId(attachmentId),
      mediaType,
      bytes,
      width,
      height,
      ...(name === undefined ? {} : { name }),
    },
  }
}

/** Parse and authorize a bridge-owned attachment token for exactly one agent session. */
export function decodeWebAttachmentReference(value: string, expectedSessionId: string): ImageAttachmentRef {
  const parsed = parseWebAttachmentReference(value)
  if (parsed.sessionId !== expectedSessionId || !expectedSessionId) {
    throw new VisionBridgeError('VISION_INVALID_ARGUMENT', 'WebUI attachment belongs to a different agent session')
  }
  return parsed.ref
}

function maxRequestBytes(config: ResolvedConfig): number {
  return Math.ceil((config.maxImageBytes * config.maxImages * 4) / 3) + REQUEST_OVERHEAD_BYTES
}

async function readJson(req: IncomingMessage, maximum: number): Promise<unknown> {
  const declared = req.headers['content-length']
  if (declared !== undefined) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0) httpError(400, 'VISION_WEB_INVALID_REQUEST')
    if (length > maximum) httpError(413, 'VISION_IMAGE_TOO_LARGE')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    total += bytes.byteLength
    if (total > maximum) httpError(413, 'VISION_IMAGE_TOO_LARGE')
    chunks.push(bytes)
  }
  if (req.aborted) httpError(400, 'VISION_WEB_REQUEST_ABORTED')
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'))
  } catch {
    return httpError(400, 'VISION_WEB_INVALID_JSON')
  }
}

function sameOrigin(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const host = req.headers.host
  const origin = req.headers.origin
  if (typeof host !== 'string' || typeof origin !== 'string') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.host === host
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
  } catch {
    return false
  }
}

function safeName(value: unknown): string {
  if (typeof value !== 'string') httpError(400, 'VISION_WEB_INVALID_IMAGE')
  const basename = value.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'pasted-image'
  if (!basename || hasControlCharacters(basename)) httpError(400, 'VISION_WEB_INVALID_IMAGE')
  return takeCodePoints(basename, MAX_FILE_NAME_CHARS).text
}

function decodeBrowserImages(value: unknown, config: ResolvedConfig): BrowserImageInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > config.maxImages) {
    return httpError(400, 'VISION_WEB_INVALID_IMAGE_COUNT')
  }
  return value.map((item): BrowserImageInput => {
    if (!isRecord(item)) return httpError(400, 'VISION_WEB_INVALID_IMAGE')
    const { data, mediaType } = item
    if (typeof data !== 'string' || !data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) {
      return httpError(400, 'VISION_WEB_INVALID_BASE64')
    }
    if (data.length > Math.ceil((config.maxImageBytes * 4) / 3) + 4) {
      return httpError(413, 'VISION_IMAGE_TOO_LARGE')
    }
    if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
      return httpError(415, 'VISION_UNSUPPORTED_IMAGE')
    }
    return { name: safeName(item.name), mediaType, data }
  })
}

function decodeBase64(input: BrowserImageInput, config: ResolvedConfig): SaveImageAttachment {
  const bytes = Buffer.from(input.data, 'base64')
  if (bytes.toString('base64') !== input.data) httpError(400, 'VISION_WEB_INVALID_BASE64')
  if (bytes.byteLength > config.maxImageBytes) httpError(413, 'VISION_IMAGE_TOO_LARGE')
  const detected = detectImageMime(bytes)
  if (detected === undefined || detected !== input.mediaType) httpError(415, 'VISION_UNSUPPORTED_IMAGE')
  return { data: Uint8Array.from(bytes), mediaType: detected, name: input.name }
}

function writeJson(res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  })
  res.end(body)
}

function readiness(config: ResolvedConfig) {
  return {
    configured: config.providers.length > 0,
    defaultProvider: config.defaultProvider ?? null,
    providerIds: config.providers.map(provider => provider.id),
  }
}

function textReferencesBridgeAttachment(text: string, reference: string): boolean {
  const suffix = `](${reference})`
  for (const line of text.split('\n')) {
    if (!line.startsWith('[Attached image ') || !line.endsWith(suffix)) continue
    const label = line.slice('[Attached image '.length, line.length - suffix.length)
    if (/^[1-9][0-9]*$/u.test(label)) return true
  }
  return false
}

/**
 * The official attachment RPC only authorizes native image blocks. Bridge
 * images deliberately remain text for a text-only main route, so authorize
 * their history thumbnail against the exact reference in a direct user turn.
 */
function sessionReferencesBridgeAttachment(events: readonly unknown[], reference: string): boolean {
  for (const event of events) {
    if (!isRecord(event) || event.type !== 'user/message' || !isRecord(event.data)) continue
    const source = event.data.source
    if (!isRecord(source) || source.kind !== 'user' || !Array.isArray(event.data.content)) continue
    for (const block of event.data.content) {
      if (isRecord(block) && block.type === 'text' && typeof block.text === 'string'
        && textReferencesBridgeAttachment(block.text, reference)) return true
    }
  }
  return false
}

function writeImage(res: ServerResponse, value: { readonly ref: ImageAttachmentRef; readonly data: Uint8Array }): void {
  const body = Buffer.from(value.data)
  res.writeHead(200, {
    'content-type': value.ref.mediaType,
    'content-length': String(body.byteLength),
    'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'",
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/** Read a bridge image only after the owning live session durably references its exact token. */
export function createWebAttachmentHandler(options: WebAttachmentHandlerOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'VISION_WEB_METHOD_NOT_ALLOWED' }, { allow: 'POST' })
        return
      }
      if (!sameOrigin(req)) httpError(403, 'VISION_WEB_ORIGIN_REJECTED')
      const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') httpError(415, 'VISION_WEB_CONTENT_TYPE_REJECTED')
      const body = await readJson(req, REQUEST_OVERHEAD_BYTES)
      if (!isRecord(body) || typeof body.reference !== 'string' || !body.reference) {
        httpError(400, 'VISION_WEB_INVALID_ATTACHMENT_REFERENCE')
      }
      const reference = body.reference as string
      let parsed: ParsedWebAttachmentReference
      try {
        parsed = parseWebAttachmentReference(reference)
      } catch {
        httpError(400, 'VISION_WEB_INVALID_ATTACHMENT_REFERENCE')
      }
      const session = options.session(parsed.sessionId)
      if (session === undefined) httpError(404, 'VISION_WEB_SESSION_NOT_FOUND')
      if (!sessionReferencesBridgeAttachment(session.events, reference)) {
        httpError(403, 'VISION_WEB_ATTACHMENT_NOT_REFERENCED')
      }
      try {
        writeImage(res, await options.attachments.readImage(parsed.ref))
      } catch {
        httpError(404, 'VISION_WEB_ATTACHMENT_UNAVAILABLE')
      }
    } catch (error) {
      if (res.headersSent || res.destroyed) return
      if (error instanceof WebDraftHttpError) {
        writeJson(res, error.status, { error: error.code })
        return
      }
      writeJson(res, 500, { error: 'VISION_WEB_INTERNAL' })
    }
  }
}

function boundedIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !value || hasControlCharacters(value)
    || takeCodePoints(value, MAX_MODEL_ID_CHARS).truncated) {
    httpError(400, 'VISION_WEB_INVALID_MODEL')
  }
  return value
}

/**
 * Resolve native-vs-bridge before image admission. This mirrors the Host's
 * documented rc.6 capability rule without creating a rejected prompt, so the
 * official client's sticky promptError remains untouched.
 */
export function createWebImageRouteHandler(options: WebImageRouteHandlerOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'VISION_WEB_METHOD_NOT_ALLOWED' }, { allow: 'POST' })
        return
      }
      if (!sameOrigin(req)) httpError(403, 'VISION_WEB_ORIGIN_REJECTED')
      const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') httpError(415, 'VISION_WEB_CONTENT_TYPE_REJECTED')
      const body = await readJson(req, REQUEST_OVERHEAD_BYTES)
      if (!isRecord(body) || typeof body.sessionId !== 'string' || !body.sessionId
        || takeCodePoints(body.sessionId, MAX_SESSION_ID_CHARS).truncated) {
        httpError(400, 'VISION_WEB_INVALID_SESSION')
      }
      const sessionId = body.sessionId as string
      if (!options.hasSession(sessionId)) httpError(404, 'VISION_WEB_SESSION_NOT_FOUND')
      const provider = boundedIdentifier(body.provider)
      const model = boundedIdentifier(body.model)
      let info: { readonly inputModalities?: readonly string[] }
      try {
        info = await options.resolveModelInfo(provider, model)
      } catch {
        httpError(503, 'VISION_WEB_MODEL_CAPABILITY_UNAVAILABLE')
      }
      const route = info.inputModalities !== undefined && !info.inputModalities.includes('image')
        ? 'bridge'
        : 'native'
      writeJson(res, 200, { route, ...readiness(options.config) })
    } catch (error) {
      if (res.headersSent || res.destroyed) return
      if (error instanceof WebDraftHttpError) {
        writeJson(res, error.status, { error: error.code })
        return
      }
      writeJson(res, 500, { error: 'VISION_WEB_INTERNAL' })
    }
  }
}

/** Same-origin Web route used only by the bundled browser client. */
export function createWebDraftHandler(options: WebDraftHandlerOptions) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'VISION_WEB_METHOD_NOT_ALLOWED' }, { allow: 'POST' })
        return
      }
      if (!sameOrigin(req)) httpError(403, 'VISION_WEB_ORIGIN_REJECTED')
      const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') httpError(415, 'VISION_WEB_CONTENT_TYPE_REJECTED')
      const body = await readJson(req, maxRequestBytes(options.config))
      if (!isRecord(body) || typeof body.sessionId !== 'string' || !body.sessionId
        || takeCodePoints(body.sessionId, MAX_SESSION_ID_CHARS).truncated) {
        httpError(400, 'VISION_WEB_INVALID_SESSION')
      }
      const sessionId = body.sessionId as string
      if (!options.hasSession(sessionId)) httpError(404, 'VISION_WEB_SESSION_NOT_FOUND')
      const images = decodeBrowserImages(body.images, options.config)
      const state = readiness(options.config)
      if (!state.configured) {
        writeJson(res, 200, { ...state, references: [] })
        return
      }

      const admitted = images.map(image => decodeBase64(image, options.config))
      const total = admitted.reduce((sum, image) => sum + image.data.byteLength, 0)
      if (total > MAX_TOTAL_LOCAL_IMAGE_BYTES) httpError(413, 'VISION_IMAGE_TOO_LARGE')
      try {
        for (const image of admitted) await options.attachments.validateImage(image)
      } catch {
        httpError(400, 'VISION_IMAGE_VALIDATION_FAILED')
      }
      const refs: ImageAttachmentRef[] = []
      try {
        for (const image of admitted) refs.push(await options.attachments.saveImage(image))
      } catch {
        httpError(500, 'VISION_ATTACHMENT_SAVE_FAILED')
      }
      writeJson(res, 201, {
        ...state,
        references: refs.map(ref => encodeWebAttachmentReference(sessionId, ref)),
      })
    } catch (error) {
      if (res.headersSent || res.destroyed) return
      if (error instanceof WebDraftHttpError) {
        writeJson(res, error.status, { error: error.code })
        return
      }
      writeJson(res, 500, { error: 'VISION_WEB_INTERNAL' })
    }
  }
}
