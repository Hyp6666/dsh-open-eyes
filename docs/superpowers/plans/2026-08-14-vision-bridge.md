# Vision Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Produce a tested, packed, profile-installable `dsh-open-eyes` npm bundle while preserving the `vision-bridge` runtime interfaces.

**Architecture:** A thin Cordis root registers one typed tool, while focused modules own config normalization, image admission, credentials, bounded HTTP, results, and three independent provider contracts. A separate package export registers the embedded runtime Skill.

**Tech Stack:** TypeScript ESM, Node 22 native fetch, DeepSeek Harness rc.6 public seams, Cordis 4.0.1, Schemastery 3.18.1, Vitest 4, oxlint, pnpm 11.7.0.

## Global Constraints

- Do not commit, push, create a remote repository, or publish to npm.
- Use `@deepseek-ai/*` `0.1.0-rc.6`; never resolve the `0.0.1-rc.*` latest line.
- Use no provider SDK, Python runtime, settings page, private monorepo source path, or direct business-image `node:fs` read. The browser client may only bridge ordinary composer submission through documented/public seams plus the pinned rc.6 conversation seam.
- Preserve credentials, image bytes, paths, URL queries, headers, and request bodies across every error/log boundary.
- Validate completion only with fresh typecheck, lint, unit tests, build, pack contents, and real temporary-profile install/remove evidence.

---

### Task 1: Project and package skeleton

**Files:** Create package manifests, TypeScript/lint/Vitest configuration, license, fixtures, and bundle patch.

**Interfaces:** Produces build scripts and package exports consumed by every later task.

- [x] Add exact peer/dev dependency manifests and safe scripts.
- [x] Install with pnpm 11.7.0 and generate a frozen lockfile.
- [x] Add a package-content verifier used by `prepack` and CI.
- [x] Verify an empty typed source build can run before behavior work.

### Task 2: Configuration and structured errors

**Files:** Create `src/config.ts`, `src/errors.ts`, and `tests/config.spec.ts`.

**Interfaces:** Produces `validateConfig(Config): ResolvedConfig`, provider lookup metadata, reserved-field sets, and `VisionBridgeError`.

- [x] Write configuration tests for defaults and every specified invalid cross-field combination.
- [x] Run them and confirm failure due to missing implementation.
- [x] Implement Schemastery plus defensive cross-field validation and normalization.
- [x] Run configuration tests to green.

### Task 3: MIME and image-source admission

**Files:** Create `src/mime.ts`, `src/image-source.ts`, MIME/source tests, and binary fixtures.

**Interfaces:** Produces `prepareImages(ctx, exec, inputs, config): Promise<PreparedImage[]>` with local base64 or remote URL variants.

- [x] Write magic-byte and source-boundary tests against fake public seams.
- [x] Confirm missing functions fail.
- [x] Implement MIME sniffing, URL policy, `ctx.fs` workflow, containment, attachment validation, and cancellation.
- [x] Run focused tests to green.

### Task 4: Bounded native HTTP transport

**Files:** Create `src/http.ts`, `src/credentials.ts`, and `tests/http.spec.ts`.

**Interfaces:** Produces credential-derived headers and `postJson(request): Promise<HttpJsonResponse>`.

- [x] Write native HTTP server tests for JSON, redirect rejection, limits, retry classes, Retry-After cap, timeout, abort, and redaction.
- [x] Confirm tests fail for missing transport.
- [x] Implement fused signals, streaming bounds, retries, response summaries, and cleanup.
- [x] Run focused tests to green.

### Task 5: Three independent protocol adapters

**Files:** Create provider types and one source/test pair per protocol.

**Interfaces:** Each adapter consumes `AdapterRequest` and returns normalized text/usage/request id/finish reason.

- [x] Write exact URL/header/body and response parser contract tests for OpenAI Responses.
- [x] Implement and pass OpenAI Responses without shared provider body/parser helpers.
- [x] Repeat red-green for OpenAI Chat Completions.
- [x] Repeat red-green for Anthropic Messages.

### Task 6: Tool and result rendering

**Files:** Create `src/result.ts`, `src/tool.ts`, `src/index.ts`, and `tests/tool.spec.ts`.

**Interfaces:** Produces the exported root Cordis plugin and typed `vision_analyze` definition.

- [x] Write schema, validation, selection, canonical value, render, redaction, and Unicode truncation tests.
- [x] Confirm failure before implementation.
- [x] Implement the call orchestration and exact output schema/render boundary.
- [x] Run focused and aggregate tests to green.

### Task 7: Embedded Skill and lifecycle

**Files:** Create Skill assets, `src/skill.ts`, `tests/skill.spec.ts`, and `tests/lifecycle.spec.ts`.

**Interfaces:** Produces package export `./skill` and two stable Cordis rows in `cordis.patch.yml`.

- [x] Write registration, invocation policy, asset loading, disposal, reload, and handle-leak tests.
- [x] Confirm the missing export/registration fails.
- [x] Implement runtime Skill registration and package-relative asset resolution.
- [x] Run lifecycle tests to green.

### Task 8: Documentation and repository material

**Files:** Create English/Chinese READMEs, compatibility/config/protocol/security/release docs, changelog, security, contribution, AGENTS, and GitHub templates/workflows.

**Interfaces:** Documents the exact tested configuration and release process.

- [x] Write complete bilingual operational documentation with third-party transfer disclosure.
- [x] Add security and contribution policies plus release setup.
- [x] Add Node 22.19/24 CI and tag-only trusted-publishing release workflow.
- [x] Audit prose for prohibited claims, secrets, unfinished placeholders, and unsupported features.

### Task 9: Pack/install E2E and final verification

**Files:** Create `tests/pack-install.e2e.spec.ts` and package verifier script.

**Interfaces:** Produces the distributable tgz and evidence for profile activation/removal.

- [x] Build and pack the real package, inspect its allowlisted contents, and install the tgz into an isolated temporary DSH home.
- [x] Run `dsh --profile web --dump-config` and assert both rows.
- [x] Remove the package, dump again, and assert both rows disappeared.
- [x] Run fresh install, typecheck, lint, unit tests, build, pack dry run, full pack smoke, secret/source/dependency audits, and record exact results.

### Task 10: Native-first Web paste and publish-name guard

**Files:** Add `src/client/`, `src/web-draft.ts`, `src/web-contract.ts`, browser/source/lifecycle tests, and the canonical package-name decision point.

**Interfaces:** Produces a Web `dsh.client` half that reads the current model before each image send, preserves native multimodal/unknown input, and turns an explicit text-only declaration into session-bound attachment links without visible routing instructions.

- [x] Add per-send current-model/capability resolution with no rejected prompt probe and no plugin-side modality cache.
- [x] Add bounded same-origin browser draft validation, attachment persistence, opaque references, and tool-side revalidation.
- [x] Make Skill/tool descriptions report readiness without a probe call and direct attachment-link turns to one focused tool call without injecting instructions into the user message.
- [x] Contract-test model switching, native error preservation, context-safe references, real packed Web boot/client delivery, and route lifecycle.
- [x] Fail closed against publishing the occupied unscoped npm candidate while keeping the reviewed local tarball installable.
