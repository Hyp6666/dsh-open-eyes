# Protocol contracts

All adapters use Node's native `fetch`, non-streaming JSON requests, `redirect: error`, bounded streaming response reads, per-call credentials, and the same safety instruction. They intentionally do not share a generic “OpenAI-compatible” body or response parser. After protocol-specific parsing, the tool redacts every provider-controlled text and metadata string against the credential, configured header values, remote URLs, and local image encodings. Metadata is capped at 512 Unicode code points; answer truncation is incremental and does not allocate an array for the full response.

Plugin-generated Web attachment references are resolved before adapter dispatch and become the same `PreparedImage` local-byte shape as an admitted path. Thus each adapter's local image representation below is unchanged. Native multimodal Web submissions never reach these adapters; they stay on the active DSH main route.

## OpenAI Responses

Implementation: `src/providers/openai-responses.ts`. Default path: `/responses`.

Local images are `input_image` blocks whose `image_url` is a `data:<mime>;base64,...` URL; remote images retain their HTTP(S) URL. Images precede the `input_text` question. The request sets `instructions`, `store: false`, and `stream: false`. `max_output_tokens` is sent only when configured.

Reserved `extraBody` keys: `model`, `instructions`, `input`, `max_output_tokens`, `store`, `stream`.

Parsing prefers a non-empty top-level `output_text`, then joins only `output` message-content blocks with `type: output_text`. Request id comes from `x-request-id`, falling back to payload `id`. Usage uses `input_tokens`, `output_tokens`, and `total_tokens`; finish reason uses status, falling back to `incomplete_details.reason`.

## OpenAI Chat Completions

Implementation: `src/providers/openai-chat-completions.ts`. Default path: `/chat/completions`.

The safety instruction is a system message. User content begins with `image_url` blocks and ends with the text question. The token cap field is independently configurable as `max_tokens` or `max_completion_tokens`; the request sets `stream: false`.

Reserved `extraBody` keys: `model`, `messages`, `max_tokens`, `max_completion_tokens`, `stream`.

The first choice is required. `message.content` may be a string or an array; array parsing joins only explicit `type: text` blocks. Request id comes from `x-request-id`, falling back to payload `id`. `prompt_tokens` and `completion_tokens` normalize to input/output tokens.

## Anthropic Messages

Implementation: `src/providers/anthropic-messages.ts`. Default path: `/v1/messages`.

The safety instruction is top-level `system`. Local images use a base64 source with `media_type`; remote images use a URL source. The request requires configured `max_tokens`, puts all images before the question, and sets `anthropic-version` (default `2023-06-01`).

Reserved `extraBody` keys: `model`, `system`, `max_tokens`, `messages`, `stream`.

Parsing joins only `type: text` blocks and ignores thinking, tool-use, and unknown blocks. Request id priority is `request-id`, `anthropic-request-id`, then payload `id`. Total tokens are computed only when both input and output counts exist.

## Stable error taxonomy

Callers should branch on `VisionBridgeError.code`, not message text:

`VISION_NOT_CONFIGURED`, `VISION_PROVIDER_NOT_FOUND`, `VISION_CREDENTIAL_MISSING`, `VISION_INVALID_ARGUMENT`, `VISION_PATH_OUTSIDE_WORKSPACE`, `VISION_SYMLINK_REJECTED`, `VISION_IMAGE_TOO_LARGE`, `VISION_UNSUPPORTED_IMAGE`, `VISION_IMAGE_VALIDATION_FAILED`, `VISION_REMOTE_URL_DISABLED`, `VISION_UPSTREAM_HTTP`, `VISION_UPSTREAM_PROTOCOL`, `VISION_RESPONSE_TOO_LARGE`, `VISION_TIMEOUT`, and `VISION_ABORTED`.
