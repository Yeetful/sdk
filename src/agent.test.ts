import { describe, it, expect, vi } from 'vitest'
import type { WalletClient } from 'viem'
import { yeetful, GrantError, type GrantPolicy, type Receipt } from './agent.js'

// A wallet stub: createPaymentClient only needs `account` + `signTypedData`.
const wallet = {
  account: { address: '0x1111111111111111111111111111111111111111' },
  signTypedData: vi.fn(async () => ('0x' + '11'.repeat(65)) as `0x${string}`),
} as unknown as WalletClient

const PAYTO = '0x2222222222222222222222222222222222222222'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

// base64(JSON) settle response so the SDK can extract a tx hash.
function settleHeader(transaction: string): string {
  return Buffer.from(JSON.stringify({ success: true, transaction })).toString('base64')
}

/**
 * Mock fetch: a request WITHOUT an X-PAYMENT header gets a 402 challenge for
 * `priceAtomic` USDC; the retry WITH the header settles 200.
 */
function mockFetch(priceAtomic = '10000') {
  const calls: string[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    const hasPayment = new Headers(init?.headers).has('X-PAYMENT')
    if (!hasPayment) {
      return new Response(
        JSON.stringify({
          x402Version: 1,
          accepts: [
            {
              scheme: 'exact',
              network: 'base',
              asset: USDC,
              maxAmountRequired: priceAtomic,
              payTo: PAYTO,
              maxTimeoutSeconds: 600,
              extra: { name: 'USD Coin', version: '2' },
            },
          ],
        }),
        { status: 402, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-payment-response': settleHeader('0xabc') },
    })
  }) as typeof fetch
  return { fn, calls }
}

const HOST = 'tripadvisor.x402.paysponge.com'
const URL_OK = `https://${HOST}/api/v1/location/search?searchQuery=tokyo`

function grant(over: Partial<GrantPolicy> = {}): GrantPolicy {
  return { allow: [HOST], perCallUsd: 0.05, perDayUsd: 2, ...over }
}

describe('yeetful/agent', () => {
  it('pays an allowed call within budget and tracks spend + receipt', async () => {
    const f = mockFetch('10000') // $0.01
    const receipts: Receipt[] = []
    const pay = yeetful({ wallet, grant: grant(), fetch: f.fn, onReceipt: (r) => { receipts.push(r) } })

    const res = await pay(URL_OK)
    expect(res.status).toBe(200)
    expect(pay.spentTodayUsd()).toBeCloseTo(0.01)
    expect(pay.remainingTodayUsd()).toBeCloseTo(1.99)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ host: HOST, amountUsd: 0.01, ok: true, txHash: '0xabc', note: 'settled' })
    expect(f.calls).toHaveLength(2) // 402 challenge + paid retry
  })

  it('blocks a host not on the allowlist without any network call', async () => {
    const f = mockFetch()
    const pay = yeetful({ wallet, grant: grant(), fetch: f.fn })
    await expect(pay('https://evil.com/x')).rejects.toMatchObject({
      name: 'GrantError',
      code: 'NOT_ALLOWED',
    })
    expect(f.calls).toHaveLength(0)
  })

  it('blocks a call above the per-call cap', async () => {
    const f = mockFetch('10000') // $0.01
    const pay = yeetful({ wallet, grant: grant({ perCallUsd: 0.005 }), fetch: f.fn })
    await expect(pay(URL_OK)).rejects.toMatchObject({ code: 'OVER_PER_CALL' })
    expect(pay.spentTodayUsd()).toBe(0)
  })

  it('blocks once the daily budget is exhausted', async () => {
    const f = mockFetch('10000') // $0.01
    const pay = yeetful({ wallet, grant: grant({ perDayUsd: 0.015 }), fetch: f.fn })
    await pay(URL_OK) // 0.01 ok
    await expect(pay(URL_OK)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' }) // 0.02 > 0.015
    expect(pay.spentTodayUsd()).toBeCloseTo(0.01)
  })

  it('blocks an expired grant', async () => {
    const f = mockFetch()
    const pay = yeetful({ wallet, grant: grant({ expiresAt: Date.now() - 1000 }), fetch: f.fn })
    await expect(pay(URL_OK)).rejects.toMatchObject({ code: 'EXPIRED' })
  })

  it('GrantError is the documented type', () => {
    const e = new GrantError('NOT_ALLOWED', 'x')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('NOT_ALLOWED')
  })
})

describe('hosted-ledger sync', () => {
  const LEDGER = 'https://yeetful.test'
  const KEY = 'yf_' + 'a'.repeat(64)

  /** Delegates paid-host calls to mockFetch; captures ledger POSTs → 201. */
  function withLedger(payFetch: typeof fetch) {
    const posts: { url: string; auth: string | null; body: Record<string, unknown> }[] = []
    const fn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith(LEDGER)) {
        posts.push({
          url,
          auth: new Headers(init?.headers).get('authorization'),
          body: JSON.parse(String(init?.body)),
        })
        return new Response(JSON.stringify({ id: 'led_1' }), { status: 201 })
      }
      return payFetch(input, init)
    }) as typeof fetch
    return { fn, posts }
  }

  it('POSTs settled receipts to the grant ledger with Bearer auth', async () => {
    const f = mockFetch('10000') // $0.01
    const l = withLedger(f.fn)
    const pay = yeetful({
      wallet,
      grant: grant({ id: 'grant123' }),
      fetch: l.fn,
      apiKey: KEY,
      ledgerUrl: LEDGER,
    })
    await pay(URL_OK)
    await pay.flushLedger()

    expect(l.posts).toHaveLength(1)
    expect(l.posts[0]!.url).toBe(`${LEDGER}/api/grants/grant123/ledger`)
    expect(l.posts[0]!.auth).toBe(`Bearer ${KEY}`)
    expect(l.posts[0]!.body).toMatchObject({
      host: HOST,
      amountUsd: 0.01,
      ok: true,
      txHash: '0xabc',
      note: 'settled',
    })
  })

  it('syncs denials too (the audit trail includes refusals)', async () => {
    const f = mockFetch()
    const l = withLedger(f.fn)
    const pay = yeetful({
      wallet,
      grant: grant({ id: 'grant123' }),
      fetch: l.fn,
      apiKey: KEY,
      ledgerUrl: LEDGER,
    })
    await expect(pay('https://evil.com/x')).rejects.toMatchObject({ code: 'NOT_ALLOWED' })
    await pay.flushLedger()

    expect(l.posts).toHaveLength(1)
    expect(l.posts[0]!.body).toMatchObject({ host: 'evil.com', amountUsd: 0, ok: false, note: 'NOT_ALLOWED' })
  })

  it('does not sync without apiKey or grant.id; flushLedger is a no-op', async () => {
    const f = mockFetch('10000')
    const l = withLedger(f.fn)
    const noKey = yeetful({ wallet, grant: grant({ id: 'grant123' }), fetch: l.fn, ledgerUrl: LEDGER })
    await noKey(URL_OK)
    await noKey.flushLedger()

    const warned: string[] = []
    const noId = yeetful({
      wallet,
      grant: grant(),
      fetch: l.fn,
      apiKey: KEY,
      ledgerUrl: LEDGER,
      onEvent: (m) => { warned.push(m) },
    })
    await noId(URL_OK)
    await noId.flushLedger()

    expect(l.posts).toHaveLength(0)
    expect(warned.some((m) => m.includes('grant.id'))).toBe(true)
  })

  it('a failing ledger endpoint never breaks payments or later syncs', async () => {
    const f = mockFetch('10000')
    let failures = 0
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith(LEDGER)) {
        failures++
        if (failures === 1) throw new Error('network down')
        return new Response('{}', { status: 201 })
      }
      return f.fn(input, init)
    }) as typeof fetch
    const pay = yeetful({
      wallet,
      grant: grant({ id: 'grant123' }),
      fetch: flaky,
      apiKey: KEY,
      ledgerUrl: LEDGER,
    })
    const r1 = await pay(URL_OK) // sync throws — payment unaffected
    const r2 = await pay(URL_OK) // chain recovered, second sync lands
    await pay.flushLedger()
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(failures).toBe(2)
  })
})
