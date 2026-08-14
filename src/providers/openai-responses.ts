import { VisionBridgeError } from '../errors.js'
import { postJson } from '../http.js'
import type { AdapterRequest, AdapterResult, NormalizedUsage } from './types.js'
import { SAFETY_INSTRUCTION } from './types.js'

const RESERVED = new Set(['model', 'instructions', 'input', 'max_output_tokens', 'store', 'stream'])

function requestUrl(baseUrl: string, endpointPath: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}${endpointPath}`
  return url.toString()
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function token(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined
}

function usageOf(payload: Record<string, unknown>): NormalizedUsage | null {
  const usage = record(payload.usage)
  if (!usage) return null
  const output: NormalizedUsage = {}
  const inputTokens = token(usage.input_tokens)
  const outputTokens = token(usage.output_tokens)
  const totalTokens = token(usage.total_tokens)
  if (inputTokens !== undefined) output.input_tokens = inputTokens
  if (outputTokens !== undefined) output.output_tokens = outputTokens
  if (totalTokens !== undefined) output.total_tokens = totalTokens
  return Object.keys(output).length ? output : null
}

function textOf(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text
  const parts: string[] = []
  if (Array.isArray(payload.output)) {
    for (const itemValue of payload.output) {
      const item = record(itemValue)
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue
      for (const contentValue of item.content) {
        const content = record(contentValue)
        if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text)
      }
    }
  }
  const text = parts.join('')
  if (!text.trim()) throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'OpenAI Responses returned no text output')
  return text
}

export async function analyzeOpenAIResponses(request: AdapterRequest): Promise<AdapterResult> {
  for (const key of Object.keys(request.provider.extraBody)) {
    if (RESERVED.has(key)) throw new VisionBridgeError('VISION_INVALID_ARGUMENT', `extraBody field ${key} is adapter-owned`)
  }
  const content = request.images.map((image) => ({
    type: 'input_image',
    image_url: image.kind === 'local' ? `data:${image.mediaType};base64,${image.base64}` : image.url,
    detail: request.detail,
  }))
  const body: Record<string, unknown> = {
    ...request.provider.extraBody,
    model: request.provider.model,
    instructions: SAFETY_INSTRUCTION,
    input: [{ role: 'user', content: [...content, { type: 'input_text', text: request.prompt }] }],
    ...(request.provider.maxOutputTokens === undefined ? {} : { max_output_tokens: request.provider.maxOutputTokens }),
    store: false,
    stream: false,
  }
  const response = await postJson({
    url: requestUrl(request.provider.baseUrl, request.provider.endpointPath),
    headers: { ...request.provider.headers, ...request.authHeaders, 'content-type': 'application/json' },
    body,
    secrets: request.secrets,
    ...request.transport,
  })
  const payload = record(response.payload)
  if (!payload) throw new VisionBridgeError('VISION_UPSTREAM_PROTOCOL', 'OpenAI Responses returned a non-object payload')
  const incomplete = record(payload.incomplete_details)
  return {
    text: textOf(payload),
    usage: usageOf(payload),
    requestId:
      response.headers.get('x-request-id') || (typeof payload.id === 'string' && payload.id ? payload.id : null),
    finishReason:
      (typeof payload.status === 'string' && payload.status) ||
      (typeof incomplete?.reason === 'string' && incomplete.reason) ||
      null,
  }
}
