import { describe, it, expect, vi } from 'vitest'
import type { WalletClient } from 'viem'
import { createPaymentClient, PaymentError } from './client.js'
import { encodePayment } from './utils.js'
import type { PaymentRequirement } from './types.js'

// createPaymentClient only touches the wallet at signing time; these tests
// reject in onPaymentRequired first, so a minimal stub suffices.
const wallet = {
  account: { address: '0x1111111111111111111111111111111111111111' },
  signTypedData: vi.fn(async () => ('0x' + '11'.repeat(65)) as `0x${string}`),
} as unknown as WalletClient

const PAYTO = '0x2222222222222222222222222222222222222222'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const v2Requirement: PaymentRequirement = {
  scheme: 'exact',
  network: 'eip155:8453',
  asset: USDC,
  amount: '20000',
  payTo: PAYTO,
  maxTimeoutSeconds: 60,
} as PaymentRequirement

const v2Challenge = {
  x402Version: 2,
  resource: { url: 'https://api.test/paid/mcp' },
  accepts: [v2Requirement],
  extensions: {},
}

function fetch402(body: BodyInit | null, headers: Record<string, string> = {}) {
  return (async () => new Response(body, { status: 402, headers })) as unknown as typeof fetch
}

/** Run the client against one canned 402 and capture what it offered to pay. */
async function offeredRequirement(
  body: BodyInit | null,
  headers: Record<string, string> = {},
): Promise<PaymentRequirement> {
  let seen: PaymentRequirement | undefined
  const pay = createPaymentClient({
    wallet,
    fetch: fetch402(body, headers),
    onPaymentRequired: (req) => {
      seen = req
      return false // stop before signing
    },
  })
  await expect(pay('https://api.test/paid/mcp')).rejects.toThrow('Payment rejected by user')
  expect(seen).toBeDefined()
  return seen as PaymentRequirement
}

describe('parsePaymentRequired (via createPaymentClient)', () => {
  it('falls back to the payment-required header when the body is {} — the live paid-door shape', async () => {
    const req = await offeredRequirement('{}', {
      'content-type': 'application/json',
      'payment-required': encodePayment(v2Challenge),
    })
    expect(req.payTo).toBe(PAYTO)
    expect(req.network).toBe('eip155:8453')
  })

  it('falls back to the header when the body has an EMPTY accepts array', async () => {
    const req = await offeredRequirement(JSON.stringify({ x402Version: 2, accepts: [] }), {
      'content-type': 'application/json',
      'payment-required': encodePayment(v2Challenge),
    })
    expect(req.payTo).toBe(PAYTO)
  })

  it('still falls back to the header for non-JSON bodies (original v2 path)', async () => {
    const req = await offeredRequirement('Payment Required', {
      'payment-required': encodePayment(v2Challenge),
    })
    expect(req.payTo).toBe(PAYTO)
  })

  it('prefers a usable body over the header', async () => {
    const bodyPayTo = '0x3333333333333333333333333333333333333333'
    const bodyChallenge = {
      x402Version: 2,
      resource: { url: 'https://api.test/paid/mcp' },
      accepts: [{ ...v2Requirement, payTo: bodyPayTo }],
      extensions: {},
    }
    const req = await offeredRequirement(JSON.stringify(bodyChallenge), {
      'content-type': 'application/json',
      'payment-required': encodePayment(v2Challenge),
    })
    expect(req.payTo).toBe(bodyPayTo)
  })

  it('throws the selector error (not a parse error) for {} with no header', async () => {
    const pay = createPaymentClient({ wallet, fetch: fetch402('{}') })
    await expect(pay('https://api.test/paid/mcp')).rejects.toThrow(
      'No acceptable payment requirement matched client constraints',
    )
  })

  it('throws a PaymentError when neither body nor header is usable', async () => {
    const pay = createPaymentClient({ wallet, fetch: fetch402('Payment Required') })
    await expect(pay('https://api.test/paid/mcp')).rejects.toThrow(PaymentError)
  })
})
