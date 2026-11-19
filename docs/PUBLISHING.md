# Publishing

[Changesets](https://github.com/changesets/changesets) manages versions and changelogs; publishing is npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) from the protected `release` environment. There is no `NPM_TOKEN`.

Every package is `"private": true` until it ships a public API, and Changesets skips private packages, so nothing is released yet. The PR that gives a package its first API removes `private` and adds a `minor` changeset, releasing it as `0.1.0`.

## Release flow

1. A PR with a changeset merges into `trunk`.
2. The Release workflow ([release.yml](../.github/workflows/release.yml)) opens or updates the `chore: version packages` PR, which bumps versions and writes each `CHANGELOG.md`.
3. Merging that PR runs the `publish` job, after approval on the `release` environment: it builds and runs `changeset publish` (`pnpm publish`, which rewrites `catalog:` / `workspace:` specifiers and does the OIDC exchange).

The release jobs install with `--ignore-scripts`, use no shared cache, and set `pnpm_config_verify_deps_before_run: "false"`, so no dependency script runs in a privileged job.

## One-time owner setup

1. Settings → Actions → General: allow GitHub Actions to create and approve pull requests.
2. Settings → Environments → `release`: required reviewers, deployment branches limited to `trunk`.
3. npm configures a trusted publisher only on an existing package, so publish each package's first version by hand (`vp run -r build && pnpm --filter <name> publish --access public`).
4. On npmjs.com, for each package: Settings → Trusted publisher → GitHub Actions, repository `thomasfosterau/effect-l10n`, workflow `release.yml`, environment `release`.
