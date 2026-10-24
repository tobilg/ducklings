# Publishing packages to npm

`.github/workflows/release.yml` publishes `@ducklings/browser`, `@ducklings/workers`, `@ducklings/workers-iceberg`, `@ducklings/workers-ducklake`, and `@ducklings/workers-spatial` with npm trusted publishing (OIDC). Publishing jobs run on GitHub-hosted runners with Node.js 22, an explicitly installed npm 11, and `id-token: write`. They do not use `NPM_TOKEN`.

The Spatial job builds its WASM and TypeScript package, runs type checks, checks the Worker bundle size, and runs the local workerd integration test before packing or publishing. The Workers job builds and tests both `@ducklings/workers` and `@ducklings/workers-iceberg` from separate native artifacts, then builds both examples before packing. The default package has httpfs and Parquet; the Iceberg package adds Avro and Iceberg. Their npm tarballs are uploaded separately as `ducklings-workers-package`, `ducklings-workers-iceberg-package`, and `ducklings-workers-spatial-package`, including during dry runs. The GitHub release includes all five WASM binaries.

## First publication of a new package

npm requires a package to exist before its trusted publisher can be configured. `@ducklings/workers-spatial` and `@ducklings/workers-iceberg` went through this at 1.5.6; repeat it only for a package that does not exist on npm yet. Publish its tested tarball once using your npm account. Do not publish placeholder packages. The workflow cannot publish a manually published version again, so the next automated release needs a new, unpublished version.

1. Use the locally built and tested tarball in `dist/`. To build it with GitHub Actions instead, commit and push the changes, then run **Release** on that branch with `version_suffix` empty and **dry_run** enabled. The workflow must already exist on the default branch for manual dispatch.
2. A workflow dry run builds and tests all five packages and uploads artifacts without publishing packages, creating a GitHub release, or deploying the examples/documentation. It does not validate npm OIDC authentication.
3. If using the workflow, download and unzip the package's artifact after its job succeeds. Place the tarball in `dist/` for the command below.
4. Using an npm account with permission to create packages in the `@ducklings` organization, log in and publish the tarball:

   ```sh
   npm login
   npm publish ./dist/ducklings-<package>-<version>.tgz --access public --tag latest
   ```

   Complete npm's authentication/2FA prompts. Keep the tarball intact: it contains the tested build. If a version already exists, use a new version; npm versions cannot be overwritten.

## Configure trusted publishers

For **each of the five packages**, open npmjs.com → package → Settings → Trusted Publisher. Select **GitHub Actions** and enter:

| Field | Value |
|---|---|
| Organization or user | `tobilg` |
| Repository | `ducklings` |
| Workflow filename | `release.yml` |
| Environment name | Leave empty; the publishing jobs do not select an environment. |
| Allowed actions | Enable direct publishing with **npm publish**. |

The configuration is per package; configuring Browser does not authorize the other packages. Enter just `release.yml`, not `.github/workflows/release.yml`. The package `repository.url` must match this GitHub repository.

New configurations must complete a successful trusted publish within **two days**, or they expire. Set these up when ready to release. If a configuration expires, delete and recreate it before publishing. Allowing only staged publishing will not work with this workflow's direct `npm publish` commands.

## Run the automated release

Once all five packages exist on npm and their trusted publisher configurations are complete:

1. Ensure the release changes are committed on `main` and the DuckDB version is ready to release. Write the version's highlights and breaking changes to `docs/releases/v<version>.md` (e.g. `docs/releases/v2.0.0.md`); the release job puts it at the top of the GitHub release body, prereleases of that version included.
2. For a stable release, push a version tag matching `DUCKDB_VERSION` in the Makefile (e.g. `v2.0.0`). Every package's target version must still be unpublished. For a prerelease, manually dispatch Release with a fresh suffix such as `-dev.1` and dry run disabled.
3. Verify that all five npm publish steps succeed. Trusted publishing generates provenance automatically for this public repository and public packages.
4. Remove the unused GitHub `NPM_TOKEN` secret and revoke the old npm token after confirming no other workflow needs it. npm package settings can then disallow traditional publishing tokens while continuing to allow OIDC.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites). Requirements checked on 2026-10-14.
