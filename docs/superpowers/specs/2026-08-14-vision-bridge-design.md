# Vision Bridge Design

## Goal

Build an independently publishable DeepSeek Harness bundle that exposes `vision_analyze` to text-only agent routes. The tool sends validated local image bytes or explicitly enabled remote image URLs to one configured multimodal provider and returns only a bounded textual analysis.

## Compatibility Baseline

The implementation targets the public contracts published on 2026-08-14: DeepSeek Harness `0.1.0-rc.6`, all consumed DSH seams `0.1.0-rc.6`, Cordis `4.0.1`, Schemastery `3.18.1`, pnpm `11.7.0`, and Node `^22.19.0 || >=24.0.0`. DSH seam packages are peers and exact development dependencies; no official package is bundled into `lib`.

## Architecture

The root Cordis plugin validates and normalizes configuration once, registers one tool, and conditionally registers a same-origin browser-draft route when Web services exist. The tool validates each call, chooses a provider, resolves its credential for that call, prepares image sources, calls one protocol adapter, bounds the returned text, and returns the canonical result.

The bundled Web client wraps the rc.6 conversation submission seam. Before each image send, it reads the current session model through the official connection API and resolves that model's declared modalities through the server LLM service. Explicit text-only declarations bridge directly; image-capable or unknown declarations retain native DSH submission. A rejected prompt is never used as a capability probe and no verdict is cached. Bridge images are batch-validated, stored once through the attachment service, and represented in durable text by concise Markdown links to session-bound opaque references; routing instructions never enter the visible user turn.

`image-source.ts` owns local/remote classification and all file trust boundaries. `http.ts` owns bounded native-fetch transport and retry behavior but no provider JSON semantics. Each file under `providers/` independently owns its endpoint, headers, request body, image representation, response parsing, usage mapping, request id, finish status, and protocol failures.

The separate `./skill` entry reads the packaged Markdown asset at module initialization and registers it through `ctx.skills.register`. Cordis effect ownership removes both the tool and skill when their fibers are disposed.

## Configuration

Schemastery supplies structural validation and defaults. `validateConfig` enforces cross-field rules, URL restrictions, safe ids, credentials/auth relationships, reserved headers/body fields, bounded positive integers, endpoint syntax, provider selection, and normalized unique extra roots. An empty provider list is valid. Anthropic requires `maxOutputTokens` because its `max_tokens` request field is mandatory; OpenAI adapters omit their token field when it is not configured.

## Data Flow

1. Validate `images`, `prompt`, optional provider, and detail without I/O.
2. Select the normalized provider or throw a stable `VisionBridgeError`.
3. Resolve the selected credential once for this call unless authentication is `none`.
4. Prepare all images sequentially with cancellation checks. Local images use only `ctx.fs`: `lstat`, `resolve`, `contains`, `stat`, bounded `readBytes`, magic-byte MIME detection, then `ctx.attachments.validateImage`. Web references use `ctx.attachments.readImage` plus session/metadata/revalidation checks. Remote URLs are never downloaded locally.
5. Build the selected adapter request with image blocks before the user question and the fixed image-prompt-injection safety instruction in the protocol-native system field.
6. Send JSON with native fetch, redirect rejection, fused cancellation/timeout, bounded response streaming, retry policy, and secret redaction.
7. Parse only explicit text blocks and normalized metadata, truncate by Unicode code point if needed, and discard raw bytes/base64/response objects after the call.

## Security Boundaries

- Configuration stores credential references only; secrets are resolved per call, never cached or logged, and redacted from every error path.
- Local relative paths require `exec.agent.session.header.cwd`; there is no `process.cwd()` fallback.
- Final symlinks are rejected before resolution. Workspace containment uses `ctx.fs.contains` against resolved roots.
- MIME comes from magic bytes, then the attachment service performs full image validation before base64 encoding.
- Remote URLs are disabled by default, never fetched by this plugin, and errors expose only a sanitized origin and path.
- Provider endpoints and remote image URLs default to HTTPS, with HTTP limited to loopback unless explicitly enabled.
- Caller-supplied headers cannot set authentication, routing, framing, or connection headers. `extraBody` cannot replace adapter-owned fields.
- Response bytes, output characters, retries, retry delay, prompt length, image count, and local image size are bounded.
- Rendered answers always begin with an untrusted-evidence boundary. Image text is evidence, never an instruction to the host agent.
- Browser submissions resolve the current model before prompt admission. Explicit text-only routing requires a same-origin current-session request and emits only the original question plus concise attachment links—no routing instructions, image bytes, browser blob URL, path, header, or credential—into durable model text.

## Error Model

`VisionBridgeError` extends the Harness structured error base and carries one of the required stable `VISION_*` codes. Abort and timeout remain distinguishable. Upstream non-2xx and malformed-success responses are bounded and redacted. No error includes request bodies, image bytes, URL query strings, headers, local absolute paths sent upstream, or credentials.

## Testing

Vitest covers configuration, MIME detection, local/remote/Web attachment sources, per-send browser capability switching, same-origin draft admission, the shared HTTP transport, all three exact wire contracts, canonical tool behavior, skill lifecycle, tool reload/disposal, package contents, and a real packed DSH Web profile install/boot/client-route/remove cycle. Provider tests use a Node native HTTP server and never call paid APIs. CI runs Node 22.19 and 24 with frozen install, typecheck, lint, tests, build, dry-run pack, and packed-install smoke.

## Distribution

`tsc` emits ESM and declarations without bundling peers. The npm allowlist contains compiled code, typings, bundle patch, skill assets, documentation, license, changelog, security, and contribution material. `prepack` runs a non-recursive release check. Tagged release automation rebuilds and uploads the tgz; npm publishing uses an explicit repository variable and npm Trusted Publishing/OIDC, with no long-lived token.
