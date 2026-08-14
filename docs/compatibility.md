# Compatibility

Research and lock date: 2026-08-15 (Asia/Shanghai).

This release is built and tested against the following exact public packages:

| Package | Locked version | npm dist-tags observed |
| --- | --- | --- |
| `@deepseek-ai/dsh` | `0.1.0-rc.6` | `latest=0.1.0-rc.6`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-agent` | `0.1.0-rc.6` | `latest=0.1.0-rc.6`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-tools` | `0.1.0-rc.6` | `latest=0.0.1-rc.1`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-credentials` | `0.1.0-rc.6` | `latest=0.0.1-rc.1`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-fs` | `0.1.0-rc.6` | `latest=0.0.1-rc.1`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-attachment` | `0.1.0-rc.6` | `latest=0.0.1-rc.1`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-attachment-local` (tests only) | `0.1.0-rc.6` | `latest=0.0.1-rc.1`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-skill` | `0.1.0-rc.6` | `latest=0.0.1-rc.1`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-llm` | `0.1.0-rc.6` | `latest=0.0.1-rc.1`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-host-webserver` | `0.1.0-rc.6` | `latest=0.0.1-rc.1`, `next=0.1.0-rc.6` |
| `@deepseek-ai/dsh-client-ui-conversation` | `0.1.0-rc.6` | `latest=0.0.1-rc.1`, `next=0.1.0-rc.6` |
| `@deepseek-ai/cordis` | `4.0.1` | `latest=4.0.1` |
| `@deepseek-ai/schemastery` | `3.18.1` | `latest=3.18.1` |

The seam packages deliberately pin the `next` rc.6 line. Installing their unqualified npm `latest` tag would select the incompatible `0.0.1-rc.1` line observed on the research date.

Node.js support follows DSH: `^22.19.0 || >=24.0.0`. The repository and CI use `pnpm@11.7.0`, matching the official Harness repository at the research point.

The Web client declares `react@^18.2.0` as a peer and builds against `18.3.1`, matching the rc.6 DSH Web runtime. React is deliberately external to `lib/client.js`: the bundle asks DSH's browser module loader for the host React instance, exactly as the official conversation client does. This prevents a second React runtime and is required because the stock user-message renderer is a `React.memo` component that must be mounted as an element.

## Evidence reviewed

The implementation was checked against the current official Harness `master` source, commit `47f943859bef60e4160492346772ded9b24f765a` (2026-08-13), including:

- the Chinese README and basic plugin, tool, config, and publish guides;
- the adding-a-tool cookbook and Skills subsystem document;
- the public filesystem, attachment, and credentials package documentation;
- the corresponding rc.6 public type declarations and implementations.

The public seams confirmed by this review are `ctx.tools.register`, `ctx.credentials.resolve(credentialRef(...))`, `ctx.fs.lstat/resolve/contains/stat/readBytes`, `ctx.attachments.validateImage/saveImage/readImage`, `ctx.skills.register`, `ctx.webServer.register`, the Host `SessionStore`, the browser connection `sessions.models` RPC, and the server LLM `resolveModelInfo` service. The Web client currently wraps the concrete rc.6 conversation `sendSession` descriptor because DSH exposes no public atomic pre-submit image middleware. Cordis caller tracing resolves that method through service shadows, so the client unwraps the canonical service and patches the descriptor owner; disposal restores it exactly. For chat-history presentation the client registers the `conversation.chat.node` slot's `user` and `steering` cells through the runtime `slots` service at a priority below the stock conversation renderers. The entry projects bridged attachment links into the stock renderer's native image-attachment blocks (thumbnail gallery) and delegates layout back to the stock components; ordinary rows are rendered by the stock components with their original props, and disposal removes both registrations. Bridge thumbnails use a plugin-owned same-origin POST reader because the official rc.6 attachment RPC correctly authorizes only references carried by native image blocks, while a text-only route must keep the bridge token in text. The reader requires the exact token in a direct user event from its live `SessionStore` session before calling `ctx.attachments.readImage`. The same-origin routes authorize against `SessionStore`, not the live Agent registry, because a blank session exists before its first accepted prompt creates an Agent loop. These narrow seams are contract-tested and are why Web paste compatibility is pinned exactly to rc.6 rather than claimed for arbitrary future releases.

The Host model registry remains the capability authority. Before every image submission, the client reads the exact current per-session provider/model and a same-origin server route resolves that model's `inputModalities`. An explicit declaration without `image` selects the bridge; an image declaration or absent declaration selects the original native DSH path. This avoids deliberately creating the rc.6 client's sticky `promptError` while retaining native ownership for unknown future-capable models. No verdict is cached. Because capability lookup and submission are separate public operations, a model switch in the narrow interval between them is a documented race; the next send rechecks.

## Registry and repository name check

On 2026-08-15, `npm view dsh-open-eyes name version dist-tags maintainers repository --json` returned npm `E404 Not Found` for the exact unscoped package name. `gh search repos dsh-open-eyes --limit 100 --json fullName,name,url,description` returned `[]`. The public web searches performed before the authoritative CLI checks also returned no exact match. The canonical package identity is therefore `dsh-open-eyes`, and repository metadata points to the intended future `Hyp6666/dsh-open-eyes` namespace without claiming that a remote repository already exists.

Name availability is inherently point-in-time. Before the first publish, rerun both exact checks and stop if either name has been taken. `publishConfig.access` remains `public`; no npm scope is inferred from the GitHub username.

No package in this project is imported from an official monorepo-private path. The `@deepseek-ai/*`, Cordis, and Schemastery seams are peers and exact development dependencies, so the published tarball does not bundle a second Cordis runtime.
