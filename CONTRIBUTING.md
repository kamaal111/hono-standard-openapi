# Contributing

## Releasing

Release Please manages the package version and changelog through a release PR targeting `main`.
Use Conventional Commits for changes merged into `main`: `fix(schema): preserve nullable defaults`
bumps the patch version, while `feat(schema): support additional metadata` bumps the minor version.
Before 1.0, breaking changes marked with `!` or a `BREAKING CHANGE:` footer bump the minor version.
Documentation and maintenance commits alone do not create a release.

Review the generated version and changelog, then merge the release PR. The release workflow creates
an unprefixed tag such as `0.0.25`, creates a GitHub release, and publishes the committed package
version to npm using trusted publishing. CI is explicitly dispatched for generated release PRs.
Do not push release tags manually or set a `VERSION` environment variable.

If npm publishing fails after the GitHub release is created, rerun the failed **Publish** job in
that workflow run. It checks out the same release tag without changing the version. Running the
release workflow again does not republish an existing release. Local `just publish` is rejected;
publishing requires the GitHub Actions release workflow's OIDC credentials.
