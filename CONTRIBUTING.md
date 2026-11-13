# Contributing to Nubis

Thanks for helping. This file covers how the repo is laid out, the rules the code follows, and how releases go out.

## Setup

```sh
bun install
bun run ci:verify
```

`ci:verify` runs everything CI does: Biome lint, `bun fmt --check`, type checks, tests, the build, and `scripts/smoke-node.mjs` on plain Node. Run it before opening a PR.

## Layout

| Path | What lives there |
| --- | --- |
| `packages/core` | `@nubisjs/core`: definitions, validation, dispatch, the reply lifecycle. No I/O. |
| `packages/nubis` | `nubis`: re-exports core, plus the HTTP handler, the CLI, `nubis/node` (loader) and `nubis/testing` |
| `packages/testing` | `@nubisjs/testing` |
| `packages/create-nubis` | The project scaffolder |
| `scripts/smoke-node.mjs` | Runs the built packages under plain Node |
| `scripts/publish.ts` | Publishes packages; see Releases |

## Rules the code follows

- **Published code runs on Node 20+ and Bun.** No `Bun.*` APIs outside the CLI. Core builds without Node or DOM types, so it can't depend on either by accident. If you touch published behavior, extend the smoke test, because that's what catches Node-only breakage.
- **Discord's rules are checked at definition time**, with the file or command in the error. If Discord would reject it, Nubis should say so first.
- **Types are a feature.** Inference changes come with type-level tests (`Equal<…>` assertions or `@ts-expect-error`) next to the runtime ones.
- **`bun fmt` formats, Biome lints.**

## Changesets

Any change users would notice needs a changeset:

```sh
bun changeset
```

All packages share one version, so pick whichever packages you touched; the rest follow.

## Releases

Releases run from `.github/workflows/release.yml` on every push to `main`:

1. Pending changesets produce a "chore: version packages" PR that bumps versions and writes changelogs.
2. Merging that PR publishes every package whose version isn't on npm yet.

`scripts/publish.ts` packs each package with `bun pm pack`, which turns `workspace:*` into real versions (npm doesn't), and publishes the tarball with npm. `bun scripts/publish.ts --dry-run` shows what would happen.

### Prereleases

The repository is in changesets' prerelease mode (`.changeset/pre.json`, tag `next`): `bun run version` makes `0.1.0-next.N` versions, and `scripts/publish.ts` publishes any version with a `-` under npm's `next` dist-tag, so `npm install nubis` still gets `latest` while `npm install nubis@next` gets the prerelease. Changesets consumed by a prerelease move to `.changeset/pre/` and come back together in the final changelog. For 0.1.0 itself: `bunx changeset pre exit`, then `bun run version`.

The workflow does nothing until the repository variable `NUBIS_RELEASE_ENABLED` is `true`. Before turning it on:

- [ ] The repository is public. npm only attaches provenance for public repositories.
- [ ] On npmjs.com, each package (`nubis`, `create-nubis`, `@nubisjs/core`, `@nubisjs/testing`) has this repository and `release.yml` as a trusted publisher. Packages that don't exist on npm yet need one first publish with a token: set the `NPM_TOKEN` secret, release, then switch to trusted publishing and delete the secret.
- [ ] Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" is on, so the version PR can be opened.
