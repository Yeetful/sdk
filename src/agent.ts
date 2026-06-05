/**
 * yeetful/agent — the "agent expense account."
 *
 * Wrap your agent's HTTP calls in a single grant-aware `pay()`. Before any x402
 * payment is signed it enforces a spend grant — an allowlist of hosts plus
 * per-call / per-day / lifetime USD caps and an expiry — then pays via the
 * standard x402 client and emits a receipt for every call.
 *
 * One grant authorizes MANY endpoints (the allowlist). It's a guardrail for
 * your own agents (runaway loops, bugs, prompt-injected tool calls) and the
 * receipt feed behind budgets + audit. Enforcement here is local + instant;
 * for hard, adversarial guarantees back the grant with an on-chain Spend
 * Permission (the wallet contract caps spend regardless of this SDK).
 *
 * @example
 * ```ts
 * import { yeetful } from 'yeetful/agent'
 *
 * const pay = yeetful({
 *   wallet,                                   // viem WalletClient
 *   grant: {
 *     allow: ['tripadvisor.x402.paysponge.com', 'anthropic.yeetful.com'],
 *     perCallUsd: 0.05,
 *     perDayUsd: 2,
 *     expiresAt: '2026-12-31',
 *   },
 *   onReceipt: (r) => console.log(r.host, r.amountUsd, r.txHash),
 * })
 *
 * const res = await pay('https://tripadvisor.x402.paysponge.com/api/v1/location/search?searchQuery=tokyo')
 * // throws GrantError on NOT_ALLOWED / OVER_PER_CALL / BUDGET_EXCEEDED / EXPIRED
 * ```
 */

import type { WalletClient } from 'viem'
import { createPaymentClient, PaymentError } from './client.js'
import { decodePayment } from './utils.js'
import type { PaymentRequirement, SettleResult, X402Network } from './types.js'

export type GrantViolation =
  | 'EXPIRED'
  | 'REVOKED'
  | 'NOT_ALLOWED'
  | 'OVER_PER_CALL'
  | 'BUDGET_EXCEEDED'

export class GrantError extends Error {
  constructor(
    public code: GrantViolation,
    message: string,
  ) {
    super(message)
    this.name = 'GrantError'
  }
}

/** A scoped spend authorization (mirrors the hosted SpendGrant). */
export interface GrantPolicy {
  /** Optional id of the hosted grant this mirrors. */
  id?: string
  /** Exact hostnames this grant may pay (e.g. "tripadvisor.x402.paysponge.com"). */
  allow: string[]
  perCallUsd: number
  perDayUsd: number
  /** Optional lifetime cap across the life of this client instance. */
  totalUsd?: number | null
  /** Unix ms, ISO string, or Date. Omit for no expiry. */
  expiresAt?: number | string | Date
  /** 'active' | 'revoked'. Defaults to active. */
  status?: string
}

/** A single authorization decision — the audit trail + x402 receipt. */
export interface Receipt {
  host: string
  amountUsd: number
  ok: boolean
  txHash?: string
  /** "settled" on success, or the GrantViolation code on a denial. */
  note: string
  ts: number
}

export interface AgentOptions {
  /** viem WalletClient that signs the EIP-3009 payment. */
  wallet: WalletClient
  /** The spend grant to enforce. */
  grant: GrantPolicy
  /** Underlying fetch (defaults to global fetch). */
  fetch?: typeof fetch
  /** Restrict payments to specific networks (defaults to all). */
  allowedNetworks?: X402Network[]
  /** Called after every decision — wire this to your ledger / dashboard. */
  onReceipt?: (receipt: Receipt) => void | Promise<void>
  /** Human-readable progress logging. */
  onEvent?: (message: string) => void
}

export interface PayFn {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
  /** USD spent under this grant since UTC midnight (this client instance). */
  spentTodayUsd(): number
  /** USD remaining in today's budget. */
  remainingTodayUsd(): number
  /** USD spent over the life of this client instance. */
  spentTotalUsd(): number
}

function expiryMs(expiresAt: GrantPolicy['expiresAt']): number {
  if (expiresAt == null) return Infinity
  if (expiresAt instanceof Date) return expiresAt.getTime()
  if (typeof expiresAt === 'number') return expiresAt
  const t = new Date(expiresAt).getTime()
  return Number.isNaN(t) ? Infinity : t
}

function utcDayIndex(ms: number): number {
  return Math.floor(ms / 86_400_000)
}

function hostOf(input: string | URL | Request): string {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

/** Pull the settlement tx hash from the X-PAYMENT-RESPONSE header, if present. */
function txHashOf(res: Response): string | undefined {
  const header = res.headers.get('x-payment-response')
  if (!header) return undefined
  try {
    return decodePayment<SettleResult>(header).transaction
  } catch {
    return undefined
  }
}

/**
 * Create a grant-aware paid `fetch`. Enforces the grant locally before signing
 * any x402 payment, pays with the wallet, and emits a receipt per call.
 */
export function yeetful(options: AgentOptions): PayFn {
  const { wallet, grant, onReceipt, onEvent } = options
  const log = onEvent ?? (() => {})

  let spentToday = 0
  let spentTotal = 0
  let dayIndex = utcDayIndex(Date.now())

  const emit = (r: Receipt) => {
    void Promise.resolve(onReceipt?.(r)).catch(() => {})
  }
  const deny = (host: string, code: GrantViolation, msg: string): never => {
    emit({ host, amountUsd: 0, ok: false, note: code, ts: Date.now() })
    log(`✗ ${host} — ${code}: ${msg}`)
    throw new GrantError(code, msg)
  }

  const pay = async function pay(
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> {
    // Roll the daily budget at UTC midnight.
    const today = utcDayIndex(Date.now())
    if (today !== dayIndex) {
      dayIndex = today
      spentToday = 0
    }

    const host = hostOf(input)

    // ── Pre-flight policy (no network): status → expiry → allowlist ─────────
    if ((grant.status ?? 'active') === 'revoked') deny(host, 'REVOKED', 'grant is revoked')
    if (Date.now() > expiryMs(grant.expiresAt)) deny(host, 'EXPIRED', 'grant has expired')
    if (!grant.allow.map((h) => h.toLowerCase()).includes(host)) {
      deny(host, 'NOT_ALLOWED', `${host} is not in this grant's allowlist`)
    }

    // Price is only known from the 402 challenge — check caps in the hook,
    // which runs after the challenge is parsed and before the payment is signed.
    let pricedUsd = 0
    const client = createPaymentClient({
      wallet,
      fetch: options.fetch,
      allowedNetworks: options.allowedNetworks,
      // Per-call enforcement lives in the hook (not maxAmountAtomic) so an
      // over-cap call surfaces a clean GrantError instead of a filtered no-match.
      onPaymentRequired: (req: PaymentRequirement) => {
        const price = Number(req.maxAmountRequired) / 1e6
        if (price > grant.perCallUsd) {
          deny(host, 'OVER_PER_CALL', `$${price.toFixed(4)} exceeds per-call cap $${grant.perCallUsd}`)
        }
        if (spentToday + price > grant.perDayUsd) {
          deny(host, 'BUDGET_EXCEEDED', `$${(spentToday + price).toFixed(2)} exceeds today's cap $${grant.perDayUsd}`)
        }
        if (grant.totalUsd != null && spentTotal + price > grant.totalUsd) {
          deny(host, 'BUDGET_EXCEEDED', `$${(spentTotal + price).toFixed(2)} exceeds lifetime cap $${grant.totalUsd}`)
        }
        pricedUsd = price
        return true
      },
    })

    let res: Response
    try {
      res = await client(input, init)
    } catch (err) {
      if (err instanceof GrantError) throw err // already denied + receipted
      // A rejection from the underlying client (e.g. no acceptable requirement).
      const note = err instanceof PaymentError ? 'payment-failed' : 'error'
      emit({ host, amountUsd: 0, ok: false, note, ts: Date.now() })
      throw err
    }

    // Settled (or a free, non-402 call where pricedUsd stayed 0).
    if (pricedUsd > 0) {
      spentToday += pricedUsd
      spentTotal += pricedUsd
    }
    const txHash = txHashOf(res)
    emit({ host, amountUsd: pricedUsd, ok: true, txHash, note: 'settled', ts: Date.now() })
    log(`✓ ${host} — $${pricedUsd.toFixed(4)} · today $${spentToday.toFixed(2)}/$${grant.perDayUsd}`)
    return res
  } as PayFn

  pay.spentTodayUsd = () => spentToday
  pay.remainingTodayUsd = () => Math.max(0, grant.perDayUsd - spentToday)
  pay.spentTotalUsd = () => spentTotal
  return pay
}
