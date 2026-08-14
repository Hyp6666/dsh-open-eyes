# Configuration

The bundle installs dormant by default. `providers: []` is valid and keeps both Cordis rows loadable; a call then returns `VISION_NOT_CONFIGURED` until a provider is configured.

The Web client also reads this state without resolving a Credential. Before prompt admission it checks the current session model's declared modalities. For an explicit text-only route, an empty provider list stops the send, preserves the browser draft, saves no image, creates no synthetic user turn, and makes no vision tool call. A non-empty valid list produces opaque attachment references; only the eventual tool call resolves the selected Credential.

## Global settings

| Field | Default | Meaning |
| --- | ---: | --- |
| `providers` | `[]` | Provider profiles. |
| `defaultProvider` | unset | Optional for one provider, required and validated for multiple. |
| `timeoutMs` | `90000` | Overall provider request budget. |
| `maxImageBytes` | `10485760` | Inclusive limit per local image. |
| `maxImages` | `4` | Images per call. |
| `maxPromptChars` | `16000` | Prompt Unicode code-point limit. |
| `maxOutputChars` | `32000` | Returned text code-point limit before the marker. |
| `maxResponseBytes` | `2097152` | Maximum upstream response body. |
| `maxRetries` | `0` | Retry attempts after the first request. |
| `maxRetryDelayMs` | `5000` | Maximum Retry-After/backoff delay. |
| `allowRemoteUrls` | `false` | Permit HTTP(S) image references. |
| `allowOutsideWorkspace` | `false` | Bypass workspace/extra-root containment. |
| `extraAllowedRoots` | `[]` | Additional normalized roots for local images. |
| `allowInsecureHttp` | `false` | Permit non-loopback HTTP endpoints and image URLs. |

`maxImageBytes * maxImages` may not exceed 64 MiB. The same 64 MiB aggregate is checked again against the actual local files in each call. Tool calls run exclusively by default, avoiding overlapping base64/JSON request construction in one Harness scheduler.

## Provider settings

`id`, `protocol`, `baseUrl`, and `model` are required. `id` must match `^[a-z0-9][a-z0-9._-]*$` and be unique.

Default endpoint paths are `/responses`, `/chat/completions`, and `/v1/messages`. They are appended to the path in `baseUrl`; for example `https://api.openai.com/v1` plus `/responses` becomes `https://api.openai.com/v1/responses`. A custom `endpointPath` must start with `/` and must not contain `..`, a query, or a fragment.

OpenAI protocols default to `authMode: bearer`; Anthropic defaults to `x-api-key`. `credential` is a Credential Reference such as `VISION_OPENAI_API_KEY`, never a secret. Authenticated profiles require it; `authMode: none` forbids it and does not access `ctx.credentials`.

`maxOutputTokens` is optional for the OpenAI protocols. It is required for `anthropic-messages` because the Anthropic Messages request requires `max_tokens`. Chat Completions defaults `chatMaxTokensField` to `max_completion_tokens`; select `max_tokens` for gateways that require the older field.

Custom `headers` cannot set authentication, hop-by-hop, host, or body-length headers. Adapter-owned fields cannot be placed in `extraBody`. See [protocol-contracts.md](protocol-contracts.md) for the exact reservation lists.

## URL policy

Provider URLs must be absolute HTTP(S) URLs with no username, password, or fragment. Plain HTTP is accepted automatically only for `localhost`, `127.0.0.1`, and `[::1]`. Set `allowInsecureHttp: true` only for a trusted non-loopback HTTP deployment.

Remote image URLs follow the same HTTP policy and additionally require `allowRemoteUrls: true`. The plugin does not fetch or probe remote images; the selected provider receives the original URL and fetches it. Plugin-owned pending presentation, errors, and completed output never include paths or URL queries. However, current DSH versions losslessly snapshot tool arguments before plugin execution, so a query-bearing URL may remain in Harness task history outside that presentation. Do not put secrets in URL queries; prefer query-free, narrowly scoped URLs and keep remote URL support disabled when it is unnecessary.

## Web paste behavior

No configuration switch forces browser interception. Every image send first reads the exact current session model without submitting a prompt. An explicit text-only modality declaration activates the bridge; image-capable or unknown declarations use the original DSH native submission. This check deliberately has no cache, so later turns and model changes are re-evaluated. Because rc.6 exposes no public atomic pre-submit middleware, a model change between lookup and submission can affect that one send; the next send rechecks.

The browser endpoints are fixed at `/vision-bridge/v1/web-image-route`, `/vision-bridge/v1/web-drafts`, and `/vision-bridge/v1/web-attachment`; all are same-origin POST-only and not user-configurable. They accept no arbitrary endpoint or header. The routing endpoint is read-only. The attachment endpoint returns bytes only when the exact bridge token occurs in a direct user turn of the token's live session. Draft per-image/count/aggregate admission uses `maxImageBytes`, `maxImages`, and the fixed 64 MiB aggregate limit. Installation or package upgrade requires a Web process restart because DSH client-package metadata is process-cached; edits to this row's `config` remain subject to DSH's normal hot reload.
