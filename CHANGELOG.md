# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Chat-history presentation layer: bridged user turns render as the ordinary DSH thumbnail gallery above the user's question bubble. A `conversation.chat.node` slot entry (user and steering cells, below stock priority) projects bridge attachment links into the stock renderer's native image blocks and delegates rendering to the official components; ordinary rows keep their original props verbatim and disposal restores the stock cells. Durable user text and the model-facing data flow are unchanged.


## [0.1.0] - 2026-08-14

### Added

- `vision_analyze` visual-delegation tool with a canonical structured result and untrusted-evidence rendering.
- Independent OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages adapters using native fetch.
- Per-call Credential Reference resolution, bounded response streaming, controlled retries, stable error codes, and secret-redacted failures.
- Workspace containment, final-symlink rejection, magic-byte MIME detection, attachment decoding validation, and bounded local image admission.
- Opt-in pass-through remote image URLs without a plugin-side downloader.
- Bundled model- and user-invocable `vision-bridge` Skill with progressive security and usage references.
- Per-send DSH Web capability routing that reads the exact session model without a rejected prompt probe, keeps image-capable or unknown routes native, bridges explicit text-only routes, and never caches modality.
- Same-origin browser-draft admission with session-bound opaque attachment references and user-visible turns limited to the original question plus concise attachment links.
- Zero-tool-call readiness signaling through the Tool description and Skill, without inserting readiness or tool-call instructions into user messages.
- Bilingual documentation, GitHub community files, CI, release automation, contract tests, and real tarball profile install/remove smoke tests.

### Security

- Browser context contains no image bytes, base64, blob URL, local path, credential, or arbitrary header.
- Provider credentials, configured header values, image encodings, URLs, upstream errors, and provider-controlled metadata are protected by bounded redaction at the public boundary.
- The canonical npm identity is `@hope666/dsh-vision-bridge`, cross-checked against existing `@hope666` packages whose maintainer email and GitHub repositories match the project owner.
- Publication fails unless the built canonical package name and manifest identity agree.

[Unreleased]: https://github.com/Hyp6666/dsh-vision-bridge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Hyp6666/dsh-vision-bridge/releases/tag/v0.1.0
