# Changesets

Every change users would notice gets a changeset. Run `bun changeset`, pick the packages, choose patch, minor or major, and describe the change for the changelog.

All Nubis packages share one version (`fixed` in `config.json`), so a changeset on any of them bumps all of them. Users never have to match `nubis` with `@nubisjs/core` by hand.

See CONTRIBUTING.md for how releases go out.
