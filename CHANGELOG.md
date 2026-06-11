# Changelog

## 0.3.1

- **Fix: x402 v2 challenges crashed the client** (`TypeError: Cannot convert
  undefined to a BigInt`). Gateways that moved to protocol v2 — e.g.
  TripAdvisor's paysponge gateway — price in `amount` (not v1's
  `maxAmountRequired`), use CAIP-2 network ids (`eip155:8453`, not `base`),
  and expect the payment back in a `PAYMENT-SIGNATURE` envelope (not
  `X-PAYMENT`). The client now reads both protocol versions and replies in
  the version the challenge declared; v1 behavior is unchanged.
- Requirement selection skips entries this client can't sign (non-EVM
  networks such as `solana:…`, entries with no parseable amount) instead of
  crashing; an unpayable challenge raises a clean `PaymentError` and the
  agent receipts it as `payment-failed`.
- Settlement tx hashes are read from v2's `payment-response` header as well
  as v1's `x-payment-response`; v2 discovery docs are also parsed from the
  `payment-required` response header when the body isn't JSON.
- New exports: `requirementAtomicAmount()` (version-agnostic price reader),
  `signExactAuthorization()` (bare EIP-3009 payload), and the
  `PaymentEnvelopeV2` type.

## 0.3.0

- **New: hosted-ledger sync.** `yeetful({ wallet, grant, apiKey, ledgerUrl? })` —
  with a yeetful.com API key (`yf_…`, minted on the dashboard) and the hosted
  grant's `id`, every receipt (settlements **and** denials) POSTs to
  `{ledgerUrl}/api/grants/{grant.id}/ledger` with Bearer auth, so dashboard
  budgets and the audit feed include headless agents. Sync is an ordered,
  best-effort chain that never blocks or fails a payment.
- **New: `pay.flushLedger()`** — await before a short-lived script exits so the
  last receipts aren't dropped with the process.
- `apiKey` without `grant.id` warns once via `onEvent` and disables sync.

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
