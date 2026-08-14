# Release procedure

The repository is prepared for npm Trusted Publishing and provenance. No long-lived `NPM_TOKEN` is required by the workflow.

## Bootstrap the new npm package

The package does not exist yet, so its npm settings page cannot be used to add a Trusted Publisher before the first publication. Bootstrap exactly once from the reviewed tarball; do not put a long-lived token in this repository or its workflow:

1. Publish the reviewed public GitHub repository and signed `v0.1.0` tag first. Let the tag workflow run with `NPM_TRUSTED_PUBLISHING` unset/false; it performs all checks and uploads the tgz without publishing to npm.
2. On the maintainer's trusted machine, run `npm login` and `npm whoami`; stop unless the result is the npm account that should own this package. GitHub and npm identities are independent, so no scope is inferred from the GitHub username.
3. Confirm `npm view dsh-open-eyes` still returns `E404` and `gh search repos dsh-open-eyes` still has no exact-name collision. The canonical identity in `src/package-name.ts`, `package.json`, and the downloaded tarball manifest must agree.
4. Verify the downloaded artifact checksum and run `npm publish dsh-open-eyes-0.1.0.tgz --access public`. This is the only manual bootstrap publish. It requires the account's interactive authentication/2FA policy and is intentionally not automated here.

For the first release, publish only the tarball produced and verified by the tagged GitHub workflow. Record its checksum before the bootstrap publish.

## Enable Trusted Publishing after bootstrap

1. Create a protected GitHub environment named `npm`; require reviewer approval for production publishing.
2. In the new npm package settings, add a GitHub Actions Trusted Publisher for repository `Hyp6666/dsh-open-eyes`, workflow filename `release.yml`, environment `npm`, and permission to publish.
3. In GitHub repository variables, set `NPM_TRUSTED_PUBLISHING=true` only after the npm trust relationship is active.
4. Protect version tags and the `npm` environment according to the repository's policy. Future tag releases then use short-lived OIDC credentials and npm-generated provenance; no `NPM_TOKEN` is needed.

## Release

1. Update `CHANGELOG.md` and the package version.
2. Run `corepack pnpm@11.7.0 install --frozen-lockfile` and `pnpm run verify:release`.
3. Run `pnpm run test:e2e` and inspect `npm pack --dry-run`.
4. Create and push a signed `v*` tag after review.

## GitHub repository metadata

Use the public repository `Hyp6666/dsh-open-eyes` with `main` as the default branch and this description:

> A lightweight DeepSeek Harness vision delegation tool for text-only routes, with native OpenAI Responses, Chat Completions, and Anthropic Messages adapters.

Apply exactly these topics after the repository is created:

- `dsh-plugin`
- `deepseek-harness`
- `vision`
- `multimodal`
- `tool-plugin`
- `openai-responses`
- `anthropic`
- `typescript`

Keep `README.md` as the default English landing page. Its language switch must label the Chinese document `中文`. Enable private vulnerability reporting before accepting public security reports.

The tag workflow repeats install, typecheck, lint, unit tests, build, dry-run pack, and packed-profile smoke. It creates the tgz and uploads it to the GitHub Release. The npm publish step runs only when the repository variable is explicitly enabled and the package-name guard passes; npm's OIDC exchange and provenance use `id-token: write` on GitHub-hosted runners with modern Node/npm. Keep that variable false for the bootstrap tag.

The workflow pins GitHub-maintained actions to reviewed full commit SHAs. Review automated SHA updates before merging them; do not replace the pins with mutable major tags.
