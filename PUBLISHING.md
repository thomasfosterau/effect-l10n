# Publishing and releases

Releases are automated with [Changesets](https://github.com/changesets/changesets) and published to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC): there is no `NPM_TOKEN`.

## Before the first release

Every package is `"private": true` until it ships a public API, and Changesets ignores private packages (`privatePackages: { version: false, tag: false }` in `.changeset/config.json`), so the Release workflow neither versions nor publishes anything yet. The PR that gives a package its first real API (M1 for `@effect-l10n/messageformat`) removes `private` and adds a `minor` changeset, which releases it as `0.1.0`. Publishing an empty `0.0.0` would only reserve the name, and npm refuses it anyway while the name has no trusted publisher.

## The release flow

1. **Add a changeset with your change** (`pnpm changeset`) when [AGENTS.md](AGENTS.md#branches-and-pull-requests) requires one. CI's advisory `changeset status` job warns on a PR that changes a published package without one.
2. **Merge to `main`.** The [Release](.github/workflows/release.yml) workflow opens or updates the **"chore: version packages"** PR, which applies the bumps and writes each package's `CHANGELOG.md`. The version step is `changeset version && vp fmt && pnpm install --lockfile-only`; `"format": false` in `.changeset/config.json` stops Changesets 3 from running the IDE-only `oxfmt` shim Vite+ installs (it exits 1 outside LSP mode), and `vp fmt` formats the changelogs instead.
3. **Merge the version PR.** With no changesets left, the workflow (after approval on the `release` environment) builds every package and runs `pnpm -r publish --ignore-scripts`: pnpm rewrites `catalog:` / `workspace:` specifiers to ranges, skips private packages and versions npm already has, exchanges the job's OIDC token for a short-lived npm token, and attaches provenance (the repository is public). `changeset tag` then lets the action push the tags and create the GitHub releases.

## Owner setup (one-time)

1. **Own the `@effect-l10n` npm scope.** Create the `effect-l10n` organisation on npmjs.com (or confirm you already own it); no package can be published under the scope until it exists.
2. **Allow Actions to open the version PR.** **Settings → Actions → General → Workflow permissions** → enable **Allow GitHub Actions to create and approve pull requests**.
3. **Create and protect the `release` environment.** **Settings → Environments → New environment** `release` → **Required reviewers** (yourself) and **Deployment branches** limited to `main`.
4. **Bootstrap each package on npm.** npm configures a trusted publisher only on a package that already exists, so each package's first version is published once by hand from a clean checkout of the released commit (`vp run -r build && pnpm --filter <name> publish --access public`, logged in with publish rights on the scope), or by giving the first Release run a short-lived granular token through a temporary `NODE_AUTH_TOKEN` env entry that is removed straight after.
5. **Configure the trusted publisher** for each package on npmjs.com → package **Settings → Trusted publisher**: provider **GitHub Actions**, repository `thomasfosterau/effect-l10n`, workflow `release.yml`, environment `release`. Then delete any automation tokens and the `NPM_TOKEN` repository secret, which nothing reads any more.
6. **Protect `main`.** Require pull requests and the `ci` checks before merge, so a release is only ever triggered by merging the reviewed version PR.
