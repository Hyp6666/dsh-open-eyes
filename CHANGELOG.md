# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Moved the essential compatibility, uninstall, and rollback guidance into the bilingual README files and removed the standalone `docs/` tree from the public repository and npm package.
- Clarified that installation can be delegated to any harness with local Shell access, recommends using a harness other than the DSH instance being modified to avoid task interruption, and added concise configuration, data-boundary, troubleshooting, development, license, and security guidance to both README files.
- Simplified the Node.js compatibility range to `>=22.19.0` across package metadata and documentation.

## [0.1.0] - 2026-08-15

### Added

- `vision_analyze` visual-delegation tool with a canonical structured result and an untrusted-evidence render boundary.
- Independent OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages adapters using native `fetch`.
- Per-call Credential Reference resolution, bounded response streaming, controlled retries, stable error codes, and secret-redacted failures.
- Workspace containment, final-symlink rejection, magic-byte MIME detection, attachment decoding validation, and bounded local-image admission.
- Opt-in pass-through remote image URLs without a plugin-side downloader.
- Bundled model- and user-invocable `vision-bridge` Skill with progressive security and usage references.
- Per-send DSH Web capability routing that keeps image-capable or unknown routes native and bridges explicitly text-only routes without caching modality.
- Same-origin browser-draft admission with session-bound opaque attachment references and user-visible turns limited to the user's original text plus attachment links.
- Chat-history presentation that renders bridged image links through DSH's stock thumbnail gallery without changing durable model-facing text.
- Zero-tool-call readiness signaling through Tool and Skill context without inserting status or tool-call instructions into user messages.
- Bilingual README files, project artwork, GitHub community files, CI, release automation, contract tests, and packed-profile install/remove smoke tests.

### Fixed

- Never synthesize a default visual question; image-only sends contain only attachment links.
- Mount the stock DSH user-message renderer as a React element instead of calling its `React.memo` component as a function.
- Load bridge-history thumbnails through a bounded same-origin endpoint that authorizes the exact token against a direct user session event.

### Security

- Browser context stores no image bytes, base64, local absolute path, credential, or arbitrary request header.
- Provider credentials, configured header values, image encodings, URLs, upstream errors, and provider-controlled metadata are bounded and redacted at public error/render boundaries.
- Publication fails unless the built canonical package name and manifest identity agree.

[Unreleased]: https://github.com/Hyp6666/dsh-open-eyes/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Hyp6666/dsh-open-eyes/releases/tag/v0.1.0
