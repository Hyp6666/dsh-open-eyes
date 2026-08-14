import { createVisionBridgeSendSession } from './bridge.js'
import type { BridgeConversation, BridgeCurrentModelResolver } from './bridge.js'

export const inject = ['conversation', 'connection']

interface ClientContextLike {
  get(name: string): unknown
  effect(execute: () => (() => void), label?: string): unknown
}

const PATCH_MARKER = Symbol.for('dsh-vision-bridge.client.send-session')
const CORDIS_ORIGINAL = Symbol.for('cordis.original')
const ACTIVE_ATTRIBUTE = 'data-dsh-vision-bridge-client'

type PatchableConversation = BridgeConversation & {
  [PATCH_MARKER]?: BridgeConversation['sendSession']
}

interface ClientConnectionLike {
  readonly api: {
    readonly sessions: {
      models(request: { readonly sessionId: string }): Promise<{
        readonly result: {
          readonly ok: true
          readonly value: {
            readonly current: { readonly provider: string; readonly model: string }
          }
        } | {
          readonly ok: false
          readonly error: { readonly code: string; readonly message: string }
        }
      }>
    }
  }
}

function isConversation(value: unknown): value is PatchableConversation {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  const conversation = value as Partial<BridgeConversation>
  return typeof conversation.sendSession === 'function'
    && typeof conversation.draftImages === 'function'
    && typeof conversation.releaseDraftImages === 'function'
}

/**
 * Cordis services are caller-traced proxies. Assigning a method on that proxy
 * creates a caller shadow rather than changing the root singleton used by the
 * composer. rc.6 exposes the canonical target through cordis.original; plain
 * test doubles and future untraced services fall back to the supplied value.
 */
function canonicalConversation(value: unknown): PatchableConversation | undefined {
  if (!isConversation(value)) return undefined
  const original = (value as unknown as Record<PropertyKey, unknown>)[CORDIS_ORIGINAL]
  return isConversation(original) ? original : value
}

function currentModelResolver(value: unknown): BridgeCurrentModelResolver | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const connection = value as Partial<ClientConnectionLike>
  if (typeof connection.api?.sessions?.models !== 'function') return undefined
  return async (sessionId) => {
    const { result } = await connection.api!.sessions.models({ sessionId })
    if (!result.ok) {
      throw new Error(`Vision Bridge could not read the current session model (${result.error.code}).`)
    }
    const { provider, model } = result.value.current
    if (!provider || !model) throw new Error('Vision Bridge received an invalid current model selection.')
    return { provider, model }
  }
}

/**
 * A Cordis trace proxy resolves prototype methods before binding them to a
 * caller shadow. Patch the descriptor owner so every caller context observes
 * the bridge, including the conversation package's rootCtx lookup.
 */
function sendSessionOwner(conversation: PatchableConversation): PatchableConversation {
  let current: object | null = conversation
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'sendSession')
    if (typeof descriptor?.value === 'function') return current as PatchableConversation
    current = Object.getPrototypeOf(current)
  }
  throw new Error('vision-bridge/client: conversation sendSession descriptor is unavailable')
}

function markActive(): () => void {
  if (typeof document === 'undefined') return () => undefined
  const root = document.documentElement
  root.setAttribute(ACTIVE_ATTRIBUTE, 'active')
  return () => {
    if (root.getAttribute(ACTIVE_ATTRIBUTE) === 'active') root.removeAttribute(ACTIVE_ATTRIBUTE)
  }
}

/** Install the Web-only pasted-image admission bridge. */
export function apply(ctx: ClientContextLike): void {
  const conversation = canonicalConversation(ctx.get('conversation'))
  if (conversation === undefined) {
    throw new Error('vision-bridge/client: incompatible conversation service; expected DSH 0.1.0-rc.6')
  }
  const resolveCurrentModel = currentModelResolver(ctx.get('connection'))
  if (resolveCurrentModel === undefined) {
    throw new Error('vision-bridge/client: incompatible connection service; expected DSH 0.1.0-rc.6')
  }
  const owner = sendSessionOwner(conversation)
  if (owner[PATCH_MARKER] !== undefined) {
    throw new Error('vision-bridge/client: pasted-image bridge is already installed')
  }
  const original = owner.sendSession
  const wrapped = createVisionBridgeSendSession(conversation, resolveCurrentModel)
  owner[PATCH_MARKER] = original
  owner.sendSession = wrapped
  const clearActive = markActive()
  ctx.effect(() => () => {
    if (owner.sendSession === wrapped) owner.sendSession = original
    delete owner[PATCH_MARKER]
    clearActive()
  }, 'vision-bridge: WebUI pasted-image bridge')
}

export {
  buildBridgePrompt,
  createVisionBridgeSendSession,
} from './bridge.js'
export type {
  BridgeConversation,
  BridgeCurrentModel,
  BridgeCurrentModelResolver,
  BridgeDraftAttachment,
  BridgeSession,
  BridgeSubmitMode,
  WebDraftUploadResponse,
  WebImageRoutingResponse,
} from './bridge.js'
