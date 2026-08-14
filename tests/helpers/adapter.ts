import { Config, validateConfig } from '../../src/config.js'
import type { Protocol, ResolvedProviderConfig } from '../../src/config.js'
import type { AdapterRequest } from '../../src/providers/types.js'

export function provider(
  protocol: Protocol,
  baseUrl: string,
  overrides: Record<string, unknown> = {},
): ResolvedProviderConfig {
  return validateConfig(
    Config({
      providers: [
        {
          id: 'primary',
          protocol,
          baseUrl,
          model: 'vision-model',
          credential: 'VISION_API_KEY',
          maxOutputTokens: 123,
          ...overrides,
        },
      ],
    }),
  ).providers[0]!
}

export function request(providerConfig: ResolvedProviderConfig, overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    provider: providerConfig,
    images: [
      { kind: 'local', mediaType: 'image/png', base64: 'AQID', byteLength: 3 },
      { kind: 'remote', url: 'https://images.example.test/a.png?signature=opaque' },
    ],
    prompt: 'Read the exact error code.',
    detail: 'high',
    authHeaders: { authorization: 'Bearer test-secret' },
    secrets: ['test-secret'],
    transport: {
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      maxResponseBytes: 4_096,
      maxRetries: 0,
      maxRetryDelayMs: 50,
    },
    ...overrides,
  }
}
