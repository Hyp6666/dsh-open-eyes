# dsh-vision-bridge

A lightweight DeepSeek Harness vision delegation tool for text-only routes, with native OpenAI Responses, Chat Completions, and Anthropic Messages adapters.

> **Data disclosure:** every image selected for `vision_analyze` is transmitted to the configured third-party vision provider. For remote URLs, that provider fetches the URL itself. Review the provider's retention, privacy, and billing terms before use.

> **Package identity:** the GitHub repository remains `Hyp6666/dsh-vision-bridge`; the project name remains `dsh-vision-bridge`; its publishable public npm package is `@hope666/dsh-vision-bridge`. The npm scope was verified against the owner's existing public packages. The unscoped npm name belongs to a different publisher and is not this plugin.

## Why this exists

Harness's native image path is the right choice when the active main LLM route advertises image input. It validates and attaches an image to that same route. A text-only main route cannot consume that attachment, so `dsh-vision-bridge` can instead call a separately configured multimodal HTTP API and return its analysis as text. The official `read_image` behavior alone cannot make a text-only route accept image content.

The bundled Web client is capability-aware without deliberately submitting an unsupported image. Before every pasted-image send it reads the current session model through DSH's connection API and asks the server for that model's declared input modalities. A declared text-only route goes directly to bridge delegation; an image-capable or undeclared/unknown route remains on DSH's native image path. The decision is made again for every send and is never cached, so first-turn images, later-turn images, repeated images, and model changes use the same routing rule.

This package is intentionally narrower than ModLens and larger vision toolkits: it provides one delegation tool, three wire adapters, a Web paste bridge, and strict admission controls—not OCR pipelines, computer use, routing, a GUI settings page, or image generation. Those tools can be complementary.

This is an independent, unofficial community project. It is not endorsed by DeepSeek and is not a package under the `@deepseek-ai` namespace.

## Requirements and installation

- Node.js `^22.19.0 || >=24.0.0`
- DeepSeek Harness `0.1.0-rc.6`

Install the published package into the web profile:

```sh
dsh plugin --profile web add @hope666/dsh-vision-bridge
```

Before the first npm publication, install the reviewed local tarball instead:

```sh
dsh plugin --profile web add ./hope666-dsh-vision-bridge-0.1.0.tgz
```

Installing from a local source directory is also an official DSH form (`dsh plugin --profile web add ./dsh-vision-bridge`), but tarball installation is preferred because it tests the prebuilt artifact.

Install into the headless profile:

```sh
dsh plugin --profile headless add @hope666/dsh-vision-bridge
```

Profiles are independent. Installing or configuring `web` does not modify `headless`, and vice versa. Inspect the active composition with:

```sh
dsh --profile web --dump-config
dsh --profile headless --dump-config
```

Harness stores profile configuration under the selected DSH home (normally `~/.dsh`; use `DSH_HOME` to isolate it). User overrides live at `$DSH_HOME/profiles/<profile>/cordis.patch.yml`. Use DSH plugin commands rather than editing installed package files. The bundle adds the stable Cordis rows `vision-bridge` and `vision-bridge-skill` and starts with no provider or Credential Reference.

After installing or upgrading an already running Web profile, restart that DSH process and reload the browser. Current DSH caches whether an installed package has a `dsh.client` half for the lifetime of the process; config-only edits remain hot-reloadable.

## Credentials

Provider `credential` values are references such as `VISION_OPENAI_API_KEY`, not API keys. Configure the reference through Harness's credentials facility for the same profile/runtime, for example by supplying that environment variable to the Harness process:

```sh
export VISION_OPENAI_API_KEY='your-provider-key'
```

Never put the key in provider config, tool arguments, custom headers, prompts, screenshots, or the repository. The reference is resolved once for the selected provider after each tool call begins and is never cached.

## Complete provider examples

The examples below show an id-targeted override in the profile's `cordis.patch.yml`. Keep the sibling `vision-bridge-skill` row installed. An override replaces the row's whole `config`, so restate every non-default field you need.

### OpenAI Responses

```yaml
- id: vision-bridge
  config:
    providers:
      - id: openai-responses
        protocol: openai-responses
        baseUrl: https://api.openai.com/v1
        model: gpt-4.1-mini
        credential: VISION_OPENAI_API_KEY
        maxOutputTokens: 2048
    defaultProvider: openai-responses
    allowRemoteUrls: false
```

### OpenAI Chat Completions

```yaml
- id: vision-bridge
  config:
    providers:
      - id: openai-chat
        protocol: openai-chat-completions
        baseUrl: https://api.openai.com/v1
        model: gpt-4.1-mini
        credential: VISION_OPENAI_API_KEY
        maxOutputTokens: 2048
        chatMaxTokensField: max_completion_tokens
        extraBody:
          temperature: 0
    defaultProvider: openai-chat
```

Use `chatMaxTokensField: max_tokens` for compatible gateways that require the older name.

### Anthropic Messages

```yaml
- id: vision-bridge
  config:
    providers:
      - id: anthropic
        protocol: anthropic-messages
        baseUrl: https://api.anthropic.com
        model: claude-sonnet-4-5
        credential: VISION_ANTHROPIC_API_KEY
        maxOutputTokens: 2048
        anthropicVersion: '2023-06-01'
    defaultProvider: anthropic
```

Anthropic requires `maxOutputTokens`. OpenAI adapters omit their cap when it is not configured. For a local unauthenticated gateway, use a loopback `http://localhost:...` URL with `authMode: none` and omit `credential`.

See [configuration](docs/configuration.md) for every limit, auth rule, URL rule, and reserved field.

## Using `vision_analyze`

Arguments:

| Name | Required | Description |
| --- | --- | --- |
| `images` | yes | 1–`maxImages` local paths, enabled HTTP(S) URLs, or plugin-generated Web attachment references. |
| `prompt` | yes | A concrete visual question, up to `maxPromptChars`. |
| `provider` | no | Configured provider id; defaults to the sole/default provider. |
| `detail` | no | `auto`, `low`, or `high`; default `auto`. |

Example model call:

```json
{
  "images": ["screenshots/login-error.png"],
  "prompt": "Transcribe the dialog title and exact error code, then identify the visibly selected action. Mark unreadable text.",
  "detail": "high"
}
```

### Pasting in the WebUI

Paste, drop, or select an image in the ordinary DSH composer and send it:

1. The browser reads the current session's provider and model without submitting a prompt.
2. A same-origin, read-only route resolves that model's declared input modalities through DSH's LLM service.
3. If image input is supported or the declaration is unavailable, DSH handles the original draft natively and `vision_analyze` is not called.
4. If the model is explicitly text-only, the bridge validates every image, saves it once through `ctx.attachments.saveImage`, and returns a session-bound opaque reference.
5. The durable user turn contains only the user's question and concise Markdown attachment links such as `[Attached image 1](vision-bridge://...)`. Tool-routing, readiness, Provider, and call-count instructions stay in Tool/Skill context and are never inserted into the visible user message.

If the current route is text-only and no Provider is configured, sending stops before image upload or prompt submission. The draft remains in the composer and the browser reports an actionable configuration error; no synthetic conversation turn is created and no image is saved or sent to a third party. The Tool description remains a zero-call model-side readiness signal: `READY` includes the current default Provider and `INSTALLED BUT NOT CONFIGURED` tells the model not to probe the Tool.

Opaque Web references are plugin-generated internals, not a user input format. Public Tool Arguments still reject data URIs, direct base64, `Uint8Array`, API keys, arbitrary HTTP headers, `file:` URLs, and endpoints not present in plugin config.

The canonical output is:

```ts
interface VisionAnalyzeResult {
  text: string
  provider: string
  protocol: 'openai-responses' | 'openai-chat-completions' | 'anthropic-messages'
  model: string
  image_count: number
  usage: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  } | null
  request_id: string | null
  finish_reason: string | null
  truncated: boolean
}
```

The model-facing render contains a fixed untrusted-evidence boundary, the text, and one short provider/protocol/model/truncation line. It does not emit raw JSON, request ids, URL queries, headers, credentials, or image bytes.

## Data flow and safety

```text
Web image → read current session model → same-origin capability resolution
              ├─ image-capable/unknown → ordinary DSH native image send → main model
              └─ explicitly text-only → validate + DSH attachment store
                    → stable opaque reference → ordinary question + attachment links
                    → one vision_analyze call directed by hidden Tool/Skill context

tool path/URL/reference → admission policy → per-call credential → protocol adapter
  path: ctx.fs + containment + magic bytes + ctx.attachments.validateImage
  URL: policy validation only; the third-party Provider downloads it
  Web reference: ctx.attachments.readImage + metadata/session checks + revalidation
                       → third-party vision API → bounded JSON parser → text evidence
```

### Context and cache stability

Native mode stores the normal DSH `ImageAttachmentRef` in the durable user message; image bytes live in the DSH attachment store, not in model-context text. Bridge mode stores only the original question and concise Markdown links whose targets are session-bound `vision-bridge://attachment/...` references. It never stores a synthetic handoff paragraph or model/tool instructions in the visible user turn. The context never stores browser `blob:` URLs, image bytes, base64, local absolute paths, credentials, or request headers. The display filename is deliberately omitted from the bridge token, so identical content and verified metadata produce the same reference within a session even if the clipboard name changes.

The browser does not cache model modality. It reads the current per-session model and resolves that exact model's declaration for every image send, including later turns and after another plugin changes models. The check and the eventual native/text submission are two operations because rc.6 exposes no public atomic pre-submit middleware; a model changed in that narrow interval is therefore a documented race, and the next send rechecks. Unknown capability fails open to DSH's authoritative native path rather than stealing an image from a potentially multimodal model. DSH attachment storage is content-addressed, so saving the same encoded bytes can deduplicate storage. This plugin does **not** cache vision answers or skip a requested Provider call: doing so could return stale evidence, create a new sensitive-data cache, and obscure billing. Each `vision_analyze` call is an independent Provider request.

Both native and bridge histories are append-only. They preserve an already reusable earlier request prefix; a new image/question/tool result extends the suffix. Provider cache availability and eviction remain Provider concerns. Changing plugin configuration can change the tool description (`READY` versus not configured) for subsequent requests and may therefore affect cache reuse at that new request boundary.

Relative local paths resolve only from `exec.agent.session.header.cwd`. With no agent CWD they are rejected; there is no `process.cwd()` fallback. Final symlinks are rejected. Unless `allowOutsideWorkspace` is explicitly enabled, the resolved target must be inside that CWD or a configured `extraAllowedRoots` target according to `ctx.fs.contains`. Local files are regular files, size-bounded, magic-byte detected as PNG/JPEG/WebP/GIF, and decoded by the attachment validator before encoding.

Remote URLs are disabled by default. Enabling them does not make this plugin an image downloader: the original URL is sent to the vision provider, which performs retrieval. Non-loopback HTTP remains disabled unless `allowInsecureHttp` is set. Plugin-owned pending presentation, errors, and completed renders suppress paths and URL queries. Current DSH versions snapshot tool arguments before plugin execution, so query-bearing URLs may still appear in Harness task history outside that presentation; do not place secrets in URL queries.

Local input is capped both per image and at 64 MiB total per call. The configured per-image limit multiplied by the image-count limit may not exceed that aggregate. Provider calls use exclusive Harness scheduling so base64 and JSON request construction do not overlap with another invocation of this tool.

Images and provider text can carry prompt injection. Both the provider request and tool result say that image instructions are untrusted. Do not execute commands or follow system-prompt-shaped text found in an image. Verify consequential numbers, error messages, and code against visible evidence.

Retries default to zero. Only 429, 502, 503, 504, and recognized pre-response transient network failures are eligible. **Retries may cause duplicate provider billing** if the first attempt was processed but its response was lost.

## Troubleshooting

- `VISION_NOT_CONFIGURED`: add at least one provider to the active profile.
- `VISION_CREDENTIAL_MISSING`: configure the named Credential Reference for the Harness process; do not paste a key into YAML.
- `VISION_PROVIDER_NOT_FOUND`: correct the tool's `provider` or `defaultProvider`.
- `VISION_PATH_OUTSIDE_WORKSPACE`: move the image under the session CWD or add a reviewed root.
- `VISION_SYMLINK_REJECTED`: use the real regular-file path.
- `VISION_REMOTE_URL_DISABLED`: use a local path or explicitly enable remote URLs.
- `VISION_UNSUPPORTED_IMAGE` / `VISION_IMAGE_VALIDATION_FAILED`: provide a real decodable PNG, JPEG, WebP, or GIF; changing the extension is insufficient.
- `VISION_UPSTREAM_HTTP`: check model, endpoint, auth mode, provider quota, and protocol without exposing the key.
- `VISION_TIMEOUT` / `VISION_RESPONSE_TOO_LARGE`: adjust bounded limits only after reviewing provider behavior.
- The visible user message contains `Vision Bridge WebUI handoff`, `generated locally`, Provider readiness, or tool-call instructions: an older client bundle is still loaded. Remove/reinstall the candidate, restart the Web DSH process, and fully reload the page. The current client never emits those strings into a user turn.
- Pasted image remains in the draft with a Vision Bridge capability error: the read-only current-model/capability check was unavailable, so the plugin deliberately submitted nothing. Restart after installation and confirm the active DSH version is the exact compatible rc.6 release.
- A text-only route reports that Vision Bridge is not configured: configure the `vision-bridge` row in the active profile and resend the preserved draft. Profiles do not share configuration.
- Pasted image uses the main model instead of `vision_analyze`: this is intentional when the Host reports native image capability. Use an explicit path/URL tool request only when Provider separation is desired.

## Updating and uninstalling

Update each installed profile independently:

```sh
dsh plugin --profile web update @hope666/dsh-vision-bridge
dsh plugin --profile headless update @hope666/dsh-vision-bridge
```

Uninstall from a profile:

```sh
dsh plugin --profile web remove @hope666/dsh-vision-bridge
```

Removal deletes both package-contributed Cordis rows from that profile. It does not delete provider-side data or unset a Credential Reference.

## Compatibility and known limitations

The tested matrix and npm dist-tag caveat are in [compatibility.md](docs/compatibility.md). Current limitations:

- Web paste support relies on the DSH rc.6 conversation submission seam and requires a process restart after package installation or upgrade;
- rc.6 has no public atomic pre-submit middleware, so a model change in the narrow interval between capability lookup and submission can affect that one send; the next send always rechecks;
- browser bridge references are session-bound and are not a public manually constructible input format;
- no streaming provider response;
- no remote-image preflight, redirect probe, or local download;
- no OCR authority, image generation, computer use, routing, or Web UI settings;
- only PNG, JPEG, WebP, and GIF local images;
- provider feature/model availability and URL retrieval are external concerns.
- DSH snapshots raw tool arguments before execution; query-bearing remote URLs can appear in task history even though plugin-owned pending/error/completed presentation redacts them;

After creating the public repository, add these GitHub topics: `dsh-plugin`, `deepseek-harness`, `vision`, `multimodal`, `tool-plugin`, `openai-responses`, `anthropic`, `typescript`.

## Development and license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the exact [protocol contracts](docs/protocol-contracts.md). No ordinary test calls a paid API.

MIT © dsh-vision-bridge contributors.
