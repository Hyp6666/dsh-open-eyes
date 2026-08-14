import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ResolvedProviderConfig } from './config.js'
import { VisionBridgeError } from './errors.js'

export interface ResolvedAuth {
  readonly headers: Readonly<Record<string, string>>
  readonly secrets: readonly string[]
}

export async function resolveProviderAuth(
  ctx: Pick<Context, 'credentials'>,
  provider: ResolvedProviderConfig,
): Promise<ResolvedAuth> {
  if (provider.authMode === 'none') return { headers: Object.freeze({}), secrets: Object.freeze([]) }
  let resolved
  try {
    resolved = await ctx.credentials.resolve(credentialRef(provider.credential!))
  } catch {
    throw new VisionBridgeError('VISION_CREDENTIAL_MISSING', `credential for provider ${provider.id} could not be resolved`)
  }
  if (!resolved?.value) {
    throw new VisionBridgeError('VISION_CREDENTIAL_MISSING', `credential for provider ${provider.id} is not configured`)
  }
  const headers =
    provider.authMode === 'bearer'
      ? { authorization: `Bearer ${resolved.value}` }
      : { 'x-api-key': resolved.value }
  return { headers: Object.freeze(headers), secrets: Object.freeze([resolved.value]) }
}
