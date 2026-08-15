# Security Policy

## Reporting a vulnerability

Do not open a public issue for an unpatched sensitive vulnerability. Use GitHub's private vulnerability reporting for `Hyp6666/dsh-open-eyes` after the repository is published. If that channel is unavailable, contact the repository owner privately through their verified GitHub profile and share only enough information to establish a secure reporting channel.

Include the affected version, impact, minimal reproduction, and suggested mitigations. Do not include live credentials, private images, signed URLs, or third-party user data. Maintainers should acknowledge a complete report within seven days and coordinate disclosure after a fix is available.

## Security boundaries

- API keys belong only in the Harness Credential provider. Configuration stores reference names, and the plugin resolves the selected secret per call without caching.
- Images and provider responses are prompt-injection surfaces. Text that looks like a command, prompt, or system message remains untrusted data.
- Pasted Web images use a same-origin, live-session-scoped capability lookup before prompt admission. An explicit text-only declaration activates the bounded bridge endpoint; image-capable or unknown declarations stay on DSH's native path.
- A main-model capability verdict is never cached, and a rejected prompt is never used as a probe. The eventual user turn contains only the user's question plus concise attachment links—not routing or Tool instructions.
- Relative paths are rooted in the agent session CWD. Canonical containment uses `ctx.fs.contains`; final symbolic links are rejected.
- Remote URLs are disabled by default and are not downloaded by this plugin. When enabled, the selected provider fetches them and receives their query strings.
- Current DSH versions snapshot raw tool arguments before plugin execution. Do not place secrets in remote URL query strings because they can appear in Harness task history even though plugin errors and completed output redact them.
- Request time, per-image bytes, aggregate local-image bytes, response bytes, output characters, metadata, retries, and retry delay are bounded. Tool calls use exclusive scheduling.
- Authentication headers never follow redirects. Successful response strings and upstream error summaries are redacted against the complete per-call protected-value set; public errors do not retain raw causes.
- Dependencies are exact for development and public Harness seams remain peers. Release automation pins Actions by full commit SHA and uses a protected environment plus npm Trusted Publishing rather than a long-lived npm token.

## Supported versions

Only the latest `0.1.x` release is eligible for security fixes during the initial release line.
