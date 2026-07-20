# Changelog

## 0.10.1

- **Fix: 402 bodies of `{}` no longer kill the payment flow.** Some x402 v2
  servers (including @x402/next-based paid doors) put the full discovery
  document base64-encoded in the `payment-required` response header and ship
  a body of `{}`. `createPaymentClient` parsed the empty body as a valid
  challenge, found zero `accepts`, and refused with "No acceptable payment
  requirement matched client constraints". The client now falls back to the
  header challenge whenever the body lacks a usable non-empty `accepts`
  array — regardless of whether the body was valid JSON.

## 0.10.0

- **Embed: publishable embed keys.** `mountYeetfulChat({ key: 'yfe_…' })` —
  the host pays visitors' house-inference credits; plus page-URL reporting
  (`page=`) for per-site embed analytics.

## 0.9.0

- **Embed: host-wallet bridge.** `wallet: 'auto'` relays the host page's
  EIP-1193 provider into the iframe over postMessage — visitors sign with
  the wallet already connected to the host site.

## 0.8.0

- **New entry point: `yeetful/embed`.** `mountYeetfulChat()` drops the
  Yeetful chat iframe into any page in five lines; `sendPrompt(text)` lets
  the host inject prompts (contract `prompt` message).

## 0.7.0

- Export `USDC_DECIMALS`; fix the DTS/express build; richer JSDoc on utils.
- Adopted the versioning rule: every shipped-code PR bumps `version`.

## 0.6.0

- **New: `reportUsage()`** (server) — earn-side receipt reporting so MCP
  services can feed the two-sided dashboard.

## 0.5.0

- **New: org budgets — the two-level cap.** When the API key belongs to an
  organization on yeetful.com, `yeetful()` now reads the org's daily USD cap
  from the policy (`org` block) — summed across all the org's agents, *above*
  each key's own budget — and **refuses to pay** with
  `GrantError('OVER_ORG_BUDGET')` when the org is over its cap or a call's 402
  price would breach it. Over **either** level (per-key or org) stops the
  payment.
- **New: remote kill switch.** The policy + every receipt-sync echo now carry
  a `halted` / `haltReason` flag. When an admin pauses a single agent
  (`AGENT_PAUSED`) or freezes the whole expense account (`ACCOUNT_FROZEN`) on
  the dashboard, the SDK halts **all** payments — a hard stop before any
  budget arithmetic or network call — and resumes on the next policy refresh
  once unfrozen.
- Both ride the same `apiKey` flow as per-key budgets: loaded at startup,
  refreshed from the sync echo and `pay.flushLedger()`, with settled-but-
  unsynced org spend counted locally between syncs. Advisory at the rails for
  SDK agents (this local refusal is the enforcement); the chats Yeetful itself
  executes are hard-stopped server-side. A failed policy fetch degrades open.
- **New: `pay.orgBudget()`** (last-known `OrgBudget` | null) and
  **`pay.status()`** (`{ halted, haltReason }`).
- New `GrantViolation` codes: `OVER_ORG_BUDGET`, `AGENT_PAUSED`,
  `ACCOUNT_FROZEN`. New exported types `OrgBudget`, `HaltStatus`, `HaltReason`.

## 0.4.0

- **New: per-key agent budgets are enforced by the SDK.** On yeetful.com an
  agent IS an API key, and each key can carry a per-day USD budget (dashboard
  → Agents tab). With `apiKey` set, `yeetful()` now loads the key's policy
  from `GET {ledgerUrl}/api/agent/policy` (Bearer auth) before the first
  payment and **refuses to pay** — throwing `GrantError('OVER_AGENT_BUDGET')`
  and emitting/syncing a denial receipt — when the key is over budget or a
  call's 402 price would exceed `remainingTodayUsd`. Budgets are advisory at
  the rails (the agent pays from its own wallet), so this local refusal is
  the enforcement model; hard on-chain enforcement arrives with Coinbase
  Spend Permissions. (This replaces the parked "per-host caps" design
  question from 0.3: budgets are per key, not per host.)
- The budget stays fresh opportunistically: receipt-sync responses echo the
  updated `{ agent }` snapshot, `pay.flushLedger()` re-fetches the policy
  (picking up dashboard edits mid-run), and settled-but-unsynced local spend
  is counted against the budget in the meantime.
- **New: `pay.agentBudget()`** — the last-known `AgentBudget`
  (`keyId` / `label` / `perDayUsd` / `spentTodayUsd` / `remainingTodayUsd` /
  `overBudget`), and the `AgentBudget` type is exported.
- A failed policy fetch is logged via `onEvent` and never blocks payments
  (the grant alone still gates them); the policy GET gets the same
  cross-origin-redirect diagnosis as ledger sync — keep `ledgerUrl` on the
  canonical origin (currently `https://www.yeetful.com`).

## 0.3.2

- Ledger sync: when a receipt POST fails after a cross-origin redirect (e.g.
  apex → www, which silently strips the `Authorization` header), the
  `onEvent` log now names the redirect origin and tells you to point
  `ledgerUrl` at it.

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
