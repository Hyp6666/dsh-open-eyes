# Compatibility

Research and lock date: 2026-08-14 (Asia/Shanghai).

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

## Evidence reviewed

The implementation was checked against the current official Harness `master` source, commit `47f943859bef60e4160492346772ded9b24f765a` (2026-08-13), including:

- the Chinese README and basic plugin, tool, config, and publish guides;
- the adding-a-tool cookbook and Skills subsystem document;
- the public filesystem, attachment, and credentials package documentation;
- the corresponding rc.6 public type declarations and implementations.

The public seams confirmed by this review are `ctx.tools.register`, `ctx.credentials.resolve(credentialRef(...))`, `ctx.fs.lstat/resolve/contains/stat/readBytes`, `ctx.attachments.validateImage/saveImage/readImage`, `ctx.skills.register`, `ctx.webServer.register`, the Host `SessionStore`, the browser connection `sessions.models` RPC, and the server LLM `resolveModelInfo` service. The Web client currently wraps the concrete rc.6 conversation `sendSession` descriptor because DSH exposes no public atomic pre-submit image middleware. Cordis caller tracing resolves that method through service shadows, so the client unwraps the canonical service and patches the descriptor owner; disposal restores it exactly. The same-origin routes authorize against `SessionStore`, not the live Agent registry, because a blank session exists before its first accepted prompt creates an Agent loop. These narrow seams are contract-tested and are why Web paste compatibility is pinned exactly to rc.6 rather than claimed for arbitrary future releases.

The Host model registry remains the capability authority. Before every image submission, the client reads the exact current per-session provider/model and a same-origin server route resolves that model's `inputModalities`. An explicit declaration without `image` selects the bridge; an image declaration or absent declaration selects the original native DSH path. This avoids deliberately creating the rc.6 client's sticky `promptError` while retaining native ownership for unknown future-capable models. No verdict is cached. Because capability lookup and submission are separate public operations, a model switch in the narrow interval between them is a documented race; the next send rechecks.

## Registry and repository name check

At the initial check, `npm view dsh-vision-bridge` returned `E404`. A final check later on the same date returned a `0.1.0` package published by a different maintainer at `2026-08-14T06:58:27Z`, while this project was being prepared. Its public description also claims a text-model-to-vision proxy. No ownership or provenance link to this project was found, so the shorter npm name must not be used for this plugin.

The project owner's GitHub username is `Hyp6666`, but public npm metadata establishes the distinct npm username `hope666`: existing `@hope666/melu` and `@hope666/hey-buddy` packages list `hope666 <hongyupeng72@gmail.com>` as maintainer and point to repositories under `github.com/Hyp6666`. The local Git identity uses the same GitHub username and email. `npm whoami` returned `E401`, so no claim is made that this machine is currently authenticated to npm; ownership is established from public package metadata instead. `npm view @hope666/dsh-vision-bridge` returned `E404`, making `@hope666/dsh-vision-bridge` the available canonical package identity. `publishConfig.access` remains `public` as required for a public scoped package.

GitHub search returned several unrelated repositories with the shorter terminal name, while `Hyp6666/dsh-vision-bridge` was not present in the results. Repository metadata still points to the intended future namespace without claiming that a remote repository exists.

No package in this project is imported from an official monorepo-private path. The `@deepseek-ai/*`, Cordis, and Schemastery seams are peers and exact development dependencies, so the published tarball does not bundle a second Cordis runtime.
