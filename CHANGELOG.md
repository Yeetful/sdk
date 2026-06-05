# Changelog

## 0.2.0

- **New: `yeetful/agent` — the agent expense account.** `yeetful({ wallet, grant })`
  returns a grant-aware paid `fetch` that enforces an allowlist + per-call/per-day/
  lifetime USD caps + expiry **before** signing any x402 payment, pays via the
  existing client, and emits a `Receipt` per call. Throws a typed `GrantError`
  (`NOT_ALLOWED` / `OVER_PER_CALL` / `BUDGET_EXCEEDED` / `EXPIRED` / `REVOKED`) and
  exposes `spentTodayUsd()` / `remainingTodayUsd()` / `spentTotalUsd()`.
- Repositioned the package around spend-controlled x402 for AI agents; the
  existing `client` / `server` / `next` / `express` entries are unchanged.

## 0.1.0

- Initial release: drop-in x402 client + server (`gate`/`withPayment`/
  `paymentRequired`) + facilitator helpers.
