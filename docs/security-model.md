# Security model

## Assets and trust boundaries

- Configuration stores Credential References, never API keys.
- The credentials seam resolves a selected provider's secret once per tool call. Nothing caches it across calls.
- Local image bytes are read only through `ctx.fs`, validated through `ctx.attachments`, base64-encoded after validation, sent, and allowed to leave scope. They are never persisted by this plugin.
- Browser drafts use a same-origin, session-authorized model-capability lookup before prompt admission. An explicit text-only declaration enters the bridge; image-capable or unknown declarations stay native. Bridged drafts are batch-validated and saved once through the DSH attachment store before a model-visible opaque reference is committed.
- Provider responses are untrusted evidence. Tool rendering adds a fixed instruction boundary before their text. Every successful provider-controlled string is redacted against the per-call credential, configured header values, remote URLs, and local image encodings before it enters canonical output; provider metadata is additionally length-bounded.

## Local image admission

Relative paths require `exec.agent.session.header.cwd`; there is no `process.cwd()` fallback. The plugin `lstat`s the caller path before resolve and rejects a final symbolic link. It resolves workspace, extra roots, and image through the filesystem provider and uses `ctx.fs.contains`, not string prefixes. It requires a regular-file `stat`, uses bounded `readBytes`, identifies PNG/JPEG/WebP/GIF by magic bytes, and calls `validateImage` before base64 encoding. Per-image limits and a fixed 64 MiB aggregate local-image limit are checked. The tool uses exclusive Harness scheduling to avoid overlapping request construction.

The final symlink rule blocks a repository-owned link from silently escaping the intended root. Backends remain responsible for stable target identity and race-safe reads. Because the required admission order performs `lstat` before containment, stable error codes can distinguish some absent, symlink, and existing out-of-root paths; no bytes are read before containment succeeds. `allowOutsideWorkspace: true` deliberately removes containment and should be used only in trusted profiles.

## Browser attachment admission

The Web endpoints accept only same-origin JSON POSTs for a current SessionStore session. Cross-site requests, absent/mismatched Origin, other methods, other content types, invalid base64, MIME spoofing, too many images, and byte overflows fail before persistence. The capability endpoint is read-only and accepts only bounded session/provider/model identifiers. Draft request buffering, decoded bytes, image count, and aggregate bytes are bounded. Every image is magic-byte checked and decoded through `validateImage`; only after the whole batch passes is each item committed with `saveImage`.

The model-visible bridge token contains a session id plus the content-addressed attachment id and verified media/size/dimension metadata. It contains no bytes, base64, blob URL, local path, Credential, arbitrary header, or display filename. Tool execution requires the current Agent session id to match, calls `readImage` for digest/metadata verification, repeats magic-byte and decode validation, and only then forms Provider input. The token is not a public bearer URL or supported manual input format.

If the native main model declares image input—or its declaration is absent—none of the bridge image-storage path runs: the ordinary DSH attachment and model adapter own the data flow. The plugin never uses a rejected prompt as a capability probe and never caches a model capability verdict. It also keeps no answer cache or in-memory image registry. DSH's content-addressed store may deduplicate identical encoded bytes; attachment retention and garbage collection remain DSH concerns.

## Remote images

Remote images are off by default. When enabled, the plugin validates HTTP(S) syntax and transport policy but does not download, redirect-probe, or preflight the URL. The configured provider fetches the original URL. This avoids creating a second SSRF-capable downloader but moves retrieval behavior and network visibility to that provider. Plugin-generated pending presentation, diagnostics, and completed output display neither paths nor URL queries. DSH currently snapshots raw tool arguments before plugin execution, so query-bearing URLs may still enter task history outside the plugin-owned presentation. Do not put secrets in URL queries.

## Network response and retry controls

Native fetch refuses redirects, fuses caller cancellation with a timeout, and streams response bytes through a hard limit. Non-2xx summaries are bounded and redacted against credentials, configured header values, URLs, and image encodings. Error causes are removed at the public boundary. Retries are disabled by default and limited to 429/502/503/504 or recognized transient failures before a response. Retry-After is capped. A repeated successful charge remains possible when a response is lost; enabling retries accepts that billing risk.

## Out of scope

This plugin is not a sandbox, malware scanner, OCR authority, computer-use system, provider router, unconditional attachment interceptor, or secret store. Provider-side logging, retention, URL fetching, content policy, and billing are governed by the configured third party.
