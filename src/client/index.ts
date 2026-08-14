import { createVisionBridgeSendSession } from './bridge.js'
import type { BridgeConversation, BridgeCurrentModelResolver } from './bridge.js'
import { projectBridgeContent } from './chat-render.js'
import type { ChatContentBlock } from './chat-render.js'
import { createBridgeHistoryImageLoader } from './image-loader.js'
import { PACKAGE_NAME } from '../package-name.js'
import { createElement } from 'react'
import type { ElementType, ReactElement } from 'react'

export const inject = ['conversation', 'connection', 'slots']

interface ClientContextLike {
  get(name: string): unknown
  effect(execute: () => (() => void), label?: string): unknown
}

interface SlotEntryLike {
  /** React components include memo/forwardRef exotic objects, not just functions. */
  readonly component: ElementType
  readonly options: { readonly key?: string }
}

interface SlotsServiceLike {
  register(
    options: { name: string; key: string; priority?: number; locale?: string; registrant?: string },
    component: (props: never) => unknown,
  ): () => void
  entries(name: string): readonly SlotEntryLike[]
}

const PATCH_MARKER = Symbol.for(`${PACKAGE_NAME}.client.send-session`)
const RENDER_MARKER = Symbol.for(`${PACKAGE_NAME}.client.chat-render`)
const CORDIS_ORIGINAL = Symbol.for('cordis.original')
const ACTIVE_ATTRIBUTE = `data-${PACKAGE_NAME}-client`
const CHAT_NODE_SLOT = 'conversation.chat.node'
const CONVERSATION_NS = 'conversation'
const REGISTRANT = `${PACKAGE_NAME}/client`
/** Below the stock renderer's priority 0; lowest renders, so this entry wins its cells. */
const SHADOW_PRIORITY = -100

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

/** One keyed chat-node slot render occurrence: the stock owner props plus the node. */
type ChatNodeProps = {
  node: { kind: string; data: { content?: readonly ChatContentBlock[] } }
  loadImage?: (attachment: never) => Promise<string>
  t?: (key: string, params?: Record<string, unknown>) => string
} & Record<string, unknown>

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

/**
 * The stock user/steering renderer this bundle shadows. Rendering with the
 * original component (same props) keeps every ordinary message pixel-identical
 * without this package importing React or restyling anything.
 */
function stockRendererFor(slots: SlotsServiceLike, key: string): ElementType | null | undefined {
  return slots
    .entries(CHAT_NODE_SLOT)
    .find((entry) => entry.options.key === key && !(entry.component as unknown as Record<PropertyKey, unknown>)[RENDER_MARKER])
    ?.component
}

/**
 * Presentation upgrade for user rows whose durable text contains bridge
 * attachment links: re-express the links as the stock renderer's native image
 * attachment blocks (thumbnail gallery) and keep only the user's question in
 * the bubble. Every other row is rendered by the stock component verbatim.
 * The durable user turn and the model-facing text are never modified.
 */
function bridgeChatNodeRenderer(
  slots: SlotsServiceLike,
  key: string,
  loadBridgeImage: (attachment: unknown) => Promise<string>,
) {
  const render = (props: never): unknown => {
    const nodeProps = props as unknown as ChatNodeProps
    const content = nodeProps?.node?.data?.content
    if (!Array.isArray(content)) return stockRenderer(slots, key, props)
    const projection = projectBridgeContent(content)
    if (!projection.bridged) return stockRenderer(slots, key, props)
    const stock = stockRendererFor(slots, key)
    if (stock === undefined || stock === null) return null
    return renderStock(stock, {
      ...nodeProps,
      loadImage: loadBridgeImage,
      node: { ...nodeProps.node, data: { ...nodeProps.node.data, content: projection.content } },
    })
  }
  ;(render as unknown as Record<PropertyKey, unknown>)[RENDER_MARKER] = true
  return render
}

function renderStock(stock: ElementType, props: Record<string, unknown>): ReactElement {
  // The official renderer is React.memo(...), whose runtime value is an
  // exotic component object. It must be mounted as an element; invoking it
  // like a plain function crashes the slot and makes DSH abdicate to the
  // lower-priority stock renderer, exposing the durable attachment links.
  return createElement(stock, props)
}

function stockRenderer(slots: SlotsServiceLike, key: string, props: never): unknown {
  const stock = stockRendererFor(slots, key)
  if (stock === undefined || stock === null) return null
  return renderStock(stock, props as unknown as Record<string, unknown>)
}

/**
 * Register the presentation layer for user and steering rows. The stock
 * conversation package declares `conversation.chat.node` and occupies the
 * `user`/`steering` cells at priority 0; this entry registers at a lower
 * priority (lowest renders), so it shadows both cells for the plugin's
 * lifetime and restores them exactly on disposal. The entry declares the
 * conversation locale namespace so the renderer injects the same `t` seat
 * the stock renderer relies on, which the projection passes through when it
 * delegates rendering back to the stock component.
 */
function registerChatNodePresentation(
  ctx: ClientContextLike,
  slots: SlotsServiceLike,
  loadBridgeImage: (attachment: unknown) => Promise<string>,
): void {
  const disposers = (['user', 'steering'] as const).map((key) =>
    slots.register(
      { name: CHAT_NODE_SLOT, key, priority: SHADOW_PRIORITY, locale: CONVERSATION_NS, registrant: REGISTRANT },
      bridgeChatNodeRenderer(slots, key, loadBridgeImage),
    ),
  )
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'vision-bridge: chat node presentation')
}

function markActive(): () => void {
  if (typeof document === 'undefined') return () => undefined
  const root = document.documentElement
  root.setAttribute(ACTIVE_ATTRIBUTE, 'active')
  return () => {
    if (root.getAttribute(ACTIVE_ATTRIBUTE) === 'active') root.removeAttribute(ACTIVE_ATTRIBUTE)
  }
}

/** Install the Web-only pasted-image admission bridge and history presentation. */
export function apply(ctx: ClientContextLike): void {
  const conversation = canonicalConversation(ctx.get('conversation'))
  if (conversation === undefined) {
    throw new Error('vision-bridge/client: incompatible conversation service; expected DSH 0.1.0-rc.6')
  }
  const resolveCurrentModel = currentModelResolver(ctx.get('connection'))
  if (resolveCurrentModel === undefined) {
    throw new Error('vision-bridge/client: incompatible connection service; expected DSH 0.1.0-rc.6')
  }
  const slots = ctx.get('slots')
  if (slots === undefined || typeof (slots as SlotsServiceLike).register !== 'function'
    || typeof (slots as SlotsServiceLike).entries !== 'function') {
    throw new Error('vision-bridge/client: incompatible slots service; expected DSH 0.1.0-rc.6')
  }

  const owner = sendSessionOwner(conversation)
  if (owner[PATCH_MARKER] !== undefined) {
    throw new Error('vision-bridge/client: pasted-image bridge is already installed')
  }
  const original = owner.sendSession
  const wrapped = createVisionBridgeSendSession(conversation, resolveCurrentModel)
  const historyImages = createBridgeHistoryImageLoader()
  owner[PATCH_MARKER] = original
  owner.sendSession = wrapped
  const clearActive = markActive()
  registerChatNodePresentation(ctx, slots as SlotsServiceLike, historyImages.load)
  ctx.effect(() => () => {
    if (owner.sendSession === wrapped) owner.sendSession = original
    delete owner[PATCH_MARKER]
    historyImages.dispose()
    clearActive()
  }, 'vision-bridge: WebUI pasted-image bridge')
}

export {
  buildBridgePrompt,
  createVisionBridgeSendSession,
} from './bridge.js'
export {
  ATTACHMENT_LINK_LABEL,
  BRIDGE_REFERENCE_FIELD,
  projectBridgeContent,
} from './chat-render.js'
export { createBridgeHistoryImageLoader } from './image-loader.js'
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
export type { BridgeContentProjection, ChatContentBlock } from './chat-render.js'
