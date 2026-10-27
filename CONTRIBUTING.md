# Contributing

## Setup

```bash
git clone https://github.com/qxmcu/wave.git
cd wave
npm install
npm run dev
```

Node.js 22. On Linux, `.rpm` packaging also needs the `rpm` package.

## Before opening a PR

```bash
npx eslint src tests
npm run lint:i18n   # needs bun
npm run typecheck
npm test
```

CI runs the same checks on every pull request.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`…), checked by commitlint.
- Backend work goes in `src/main/wave`. Keep response shapes compatible with
  what the UI reads; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Any user-facing text goes through i18n. Add the key to all five files in
  `src/i18n/lang/*`.
- Add or update tests in `tests/` for backend changes. The YouTube module is
  mocked in tests; don't add tests that need network access.

## Releasing

1. Bump `version` in `package.json`.
2. Add a `## [vX.Y.Z]` section to `CHANGELOG.md`.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The **Build and Release** workflow builds macOS (arm64 + x64) and Linux and
publishes a GitHub release with the changelog section as notes.
