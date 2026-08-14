# Repository guidance for agents

Before changing this project:

1. Read the current official DeepSeek Harness development, tool, config, publish, Skills, filesystem, attachment, and credentials documentation and verify the installed public type declarations.
2. Do not introduce OpenAI or Anthropic SDKs. Use Node's native fetch.
3. Never bypass `ctx.credentials` for secrets, `ctx.fs` for business image reads, or `ctx.attachments.validateImage` for local image validation.
4. Keep `openai-responses`, `openai-chat-completions`, and `anthropic-messages` as independent adapters. Do not hide protocol differences in a generic “compatible” body/parser.
5. Never place secrets, image bytes, signed URL queries, request bodies, or authentication headers in logs, errors, snapshots, fixtures, or rendered output.
6. Any protocol change requires an exact request/response contract test and an update to `docs/protocol-contracts.md`.
7. Preserve the dormant empty-provider state and stable error codes.
8. Before claiming completion, run fresh typecheck, lint, unit tests, build, npm pack inspection, and the real temporary-profile pack/install/remove test.
9. Before every Web image send, read the current session model through the official client connection and resolve its declared input modalities through the server LLM service. Never use a rejected prompt as a capability probe and never cache the verdict. Explicit text-only routes bridge; image-capable or unknown routes stay native.
10. Durable Web context may contain only the user's original text plus concise Markdown links to session-bound DSH attachment references. Never insert routing/readiness/tool-call instructions, image bytes, base64, blob URLs, local paths, credentials, or arbitrary headers into a user turn.
11. The Web client wraps an exact rc.6 conversation seam because no public atomic pre-submit middleware exists. Any DSH upgrade must re-audit both the conversation and connection/model-info seams, update the compatibility contract, and exercise a real packed Web boot.

Do not commit, push, publish, or change repository remotes unless the user explicitly requests it.
