import { Context, Service } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import * as VisionBridge from '../src/index.js'
import { WEB_ATTACHMENT_ENDPOINT, WEB_DRAFT_ENDPOINT, WEB_IMAGE_ROUTE_ENDPOINT } from '../src/web-draft.js'

class FakeTools extends Service {
  readonly definitions = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: ToolDefinition) {
    if (this.definitions.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`)
    return this.ctx.effect(() => {
      this.definitions.set(definition.name, definition)
      return () => this.definitions.delete(definition.name)
    }, 'fake-tools.register()')
  }
}

class EmptyService extends Service {
  constructor(ctx: Context, name: string) {
    super(ctx, name)
  }
}

class FakeWebServer extends Service {
  readonly routes = new Map<string, { kind: 'exact'; path: string; handler: unknown }>()

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(route: { kind: 'exact'; path: string; handler: unknown }) {
    if (this.routes.has(route.path)) throw new Error(`duplicate route: ${route.path}`)
    this.routes.set(route.path, route)
    return () => this.routes.delete(route.path)
  }
}

class FakeSessions extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  get(sessionId: string) {
    return sessionId === 'session-1' ? { id: sessionId, events: [] } : undefined
  }
}

class FakeLlm extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  async resolveModelInfo() {
    return { inputModalities: ['text'] }
  }
}

function service(name: string) {
  return class extends EmptyService {
    constructor(ctx: Context) {
      super(ctx, name)
    }
  }
}

describe('Cordis lifecycle', () => {
  it('registers once, reloads without duplicates, removes on dispose, and schedules no background timer', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const toolService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeTools(pluginCtx) } })
    const credentialService = await ctx.plugin({ apply(pluginCtx: Context) { new (service('credentials'))(pluginCtx) } })
    const fsService = await ctx.plugin({ apply(pluginCtx: Context) { new (service('fs'))(pluginCtx) } })
    const attachmentService = await ctx.plugin({ apply(pluginCtx: Context) { new (service('attachments'))(pluginCtx) } })
    const webService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeWebServer(pluginCtx) } })
    const sessionService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeSessions(pluginCtx) } })
    const llmService = await ctx.plugin({ apply(pluginCtx: Context) { new FakeLlm(pluginCtx) } })
    const tools = (ctx as unknown as { tools: FakeTools }).tools
    const webServer = (ctx as unknown as { webServer: FakeWebServer }).webServer

    const first = await ctx.plugin(VisionBridge, VisionBridge.Config({}))
    expect(tools.definitions.has('vision_analyze')).toBe(true)
    expect(tools.definitions.size).toBe(1)
    expect(webServer.routes.has(WEB_DRAFT_ENDPOINT)).toBe(true)
    expect(webServer.routes.has(WEB_IMAGE_ROUTE_ENDPOINT)).toBe(true)
    expect(webServer.routes.has(WEB_ATTACHMENT_ENDPOINT)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)

    await first.dispose()
    expect(tools.definitions.has('vision_analyze')).toBe(false)
    expect(webServer.routes.has(WEB_DRAFT_ENDPOINT)).toBe(false)
    expect(webServer.routes.has(WEB_IMAGE_ROUTE_ENDPOINT)).toBe(false)
    expect(webServer.routes.has(WEB_ATTACHMENT_ENDPOINT)).toBe(false)

    const second = await ctx.plugin(VisionBridge, VisionBridge.Config({}))
    expect(tools.definitions.size).toBe(1)
    expect(webServer.routes.size).toBe(3)
    await second.dispose()
    expect(tools.definitions.size).toBe(0)
    expect(webServer.routes.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)

    await attachmentService.dispose()
    await llmService.dispose()
    await sessionService.dispose()
    await webService.dispose()
    await fsService.dispose()
    await credentialService.dispose()
    await toolService.dispose()
    vi.useRealTimers()
  })
})
