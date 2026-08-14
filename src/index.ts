import type { Context } from '@deepseek-ai/cordis'
import { Config as ConfigSchema, validateConfig } from './config.js'
import type { Config as VisionBridgeConfig } from './config.js'
import { createVisionTool } from './tool.js'
import {
  createWebAttachmentHandler,
  createWebDraftHandler,
  createWebImageRouteHandler,
  WEB_ATTACHMENT_ENDPOINT,
  WEB_DRAFT_ENDPOINT,
  WEB_IMAGE_ROUTE_ENDPOINT,
} from './web-draft.js'

export const name = 'vision-bridge'
export const inject = ['tools', 'credentials', 'fs', 'attachments']

export interface Config extends VisionBridgeConfig {}
export const Config = ConfigSchema

export function apply(ctx: Context, config: Config) {
  const resolved = validateConfig(config)
  ctx.inject(['webServer', 'sessions', 'llm'], (webCtx) => {
    const services = webCtx as Context & {
      webServer: { register(route: { kind: 'exact'; path: string; handler: ReturnType<typeof createWebDraftHandler> }): () => void }
      sessions: { get(sessionId: string): { readonly events: readonly unknown[] } | undefined }
      llm: {
        resolveModelInfo(provider: string, model: string): Promise<{ readonly inputModalities?: readonly string[] }>
      }
    }
    const hasSession = (sessionId: string) => services.sessions.get(sessionId) !== undefined
    const disposeAttachments = services.webServer.register({
      kind: 'exact',
      path: WEB_ATTACHMENT_ENDPOINT,
      handler: createWebAttachmentHandler({
        attachments: webCtx.attachments,
        session: sessionId => services.sessions.get(sessionId),
      }),
    })
    const disposeDrafts = services.webServer.register({
      kind: 'exact',
      path: WEB_DRAFT_ENDPOINT,
      handler: createWebDraftHandler({
        attachments: webCtx.attachments,
        // The official SessionStore contains newly materialized conversations
        // before their first successful prompt. Agents only contains live
        // agent loops, so it cannot authorize a text-only route's first image.
        hasSession,
        config: resolved,
      }),
    })
    const disposeRouting = services.webServer.register({
      kind: 'exact',
      path: WEB_IMAGE_ROUTE_ENDPOINT,
      handler: createWebImageRouteHandler({
        hasSession,
        resolveModelInfo: (provider, model) => services.llm.resolveModelInfo(provider, model),
        config: resolved,
      }),
    })
    return () => {
      disposeRouting()
      disposeDrafts()
      disposeAttachments()
    }
  })
  return ctx.tools.register(createVisionTool(ctx, resolved))
}

export { VisionBridgeError, VISION_ERROR_CODES } from './errors.js'
export type { VisionErrorCode } from './errors.js'
export type { VisionAnalyzeResult } from './result.js'
export type { AuthMode, JsonValue, Protocol, ProviderConfig } from './config.js'
export { WEB_ATTACHMENT_ENDPOINT, WEB_DRAFT_ENDPOINT, WEB_IMAGE_ROUTE_ENDPOINT } from './web-draft.js'
export { PACKAGE_NAME, PACKAGE_NAME_AVAILABLE } from './package-name.js'
