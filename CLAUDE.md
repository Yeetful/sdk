# `yeetful` SDK — working rules

This is the published **`yeetful`** npm package (repo `Yeetful/sdk`). Entry points:
`yeetful` (top-level), `yeetful/agent`, `yeetful/client`, `yeetful/server`,
`yeetful/next`, `yeetful/express`. Built with `tsup`; tested with `vitest`.

## Versioning — REQUIRED on every change

**Every PR that changes shipped code MUST bump `version` in `package.json` in
the same PR.** Decide the bump (pre-1.0 semver, currently `0.x`):

- **MINOR** (`0.X.0` → `0.X+1.0`) — any new export/feature, a behavior change, OR
  a breaking change. Pre-1.0 there is no separate major; a breaking change is
  still a minor bump but **call out "BREAKING:" in the PR title + body** so
  consumers know to read before upgrading.
- **PATCH** (`0.X.Y` → `0.X.Y+1`) — bug fixes or internal changes with **no**
  public-API or behavior change.
- **No bump** only when the diff is docs/comments/tests that don't touch shipped
  `src/` runtime or types.

Bump in the feature PR itself — never as a separate "version bump" PR after the
fact. The git log is the changelog (`0.4.0 — …`, `0.5.0 — …` style commit
subjects). Publishing to npm is a **manual, owner-gated** `npm publish` after
merge — don't publish from here.

## Before opening a PR

`npm run typecheck` (tsc over src + tests) · `npm run build` (tsup, incl. the
DTS/`.d.ts` build) · `npm test` (vitest) — **all green**. The DTS build needs
`@types/express-serve-static-core` present for the `express.ts` Request
augmentation (it's an explicit devDependency — keep it).

## Compatibility

Additive changes (new exports, JSDoc) are backward-compatible: older installs
keep working and don't need consumer code changes — that's why they're a MINOR
bump, not breaking. Never change the x402 wire format or an exported signature
without a BREAKING note.

End commits with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
