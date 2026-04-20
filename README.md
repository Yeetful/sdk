# yeetful

**Drop-in [x402](https://www.x402.org) payments for your APIs and clients.** Gate any HTTP route behind a stablecoin micropayment in a few lines — no accounts, no API keys, no webhooks. Built for [Yeetful](https://yeetful.com), MIT-licensed, works anywhere TypeScript does.

```bash
npm install yeetful viem
```

```ts
// Server — gate a route for 1¢ USDC
import { withPayment } from 'yeetful/next'

export const GET = withPayment(
  { price: '0.01', recipient: '0xYourAddress', network: 'base' },
  async () => Response.json({ secret: 'gm' })
)
```

```ts
// Client — auto-pay when a server returns 402
import { createPaymentClient } from 'yeetful/client'
import { createWalletClient, http } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
  chain: base,
  transport: http(),
})

const pay = createPaymentClient({ wallet })
const res = await pay('https://api.example.com/premium')
console.log(await res.json()) // → { secret: 'gm' }
```

---

## Why x402?

x402 is a reborn HTTP `402 Payment Required` — a protocol where servers quote a price, clients sign a stablecoin authorization, and a facilitator settles on-chain. No accounts, no Stripe dashboards, no webhook retries. Works on EVM chains today (USDC on Base, Optimism, Arbitrum, Polygon, Ethereum).

**You get:**
- Per-request pricing for any API — LLM calls, data feeds, premium endpoints, MCP tools.
- One-sentence paywalls for agents: an LLM with a wallet can now pay for what it uses.
- Instant settlement on L2 — no chargebacks, no holds, no 30-day payout delay.

---

## Install

```bash
npm install yeetful viem
# or
pnpm add yeetful viem
# or
yarn add yeetful viem
```

`viem` is a peer dependency so the SDK stays light and stays in sync with whatever viem version your app already uses.

---

## Quickstart

### Server: gate a route

#### Next.js (App Router)

```ts
// app/api/premium/route.ts
import { withPayment } from 'yeetful/next'

export const GET = withPayment(
  {
    price: '0.01',                        // USD
    recipient: '0xYourWalletAddress',     // gets paid
    network: 'base',                      // or ['base', 'optimism']
    description: 'Premium GM endpoint',
  },
  async (req) => {
    return Response.json({ message: 'gm, thanks for the cent' })
  }
)
```

#### Express

```ts
import express from 'express'
import { paymentRequired } from 'yeetful/express'

const app = express()

app.get(
  '/premium',
  paymentRequired({
    price: '0.01',
    recipient: '0xYourWalletAddress',
    network: 'base',
  }),
  (req, res) => {
    res.json({ message: 'gm', payer: req.x402?.payer })
  }
)

app.listen(3000)
```

#### Anywhere else (Hono, Bun, Cloudflare Workers, raw Node)

Use the runtime-agnostic `gate()` helper. Give it a standard `Request`, get back either a 402 `Response` or a `settle()` handle.

```ts
import { gate } from 'yeetful/server'

export default {
  async fetch(request: Request) {
    const result = await gate(request, {
      price: '0.01',
      recipient: '0xYourWalletAddress',
      network: 'base',
    })

    if (result.type === 'paymentRequired') return result.response

    // …do the paid work…
    const body = Response.json({ message: 'gm' })

    const { header } = await result.settle()
    body.headers.set('X-PAYMENT-RESPONSE', header)
    return body
  },
}
```

### Client: auto-pay

```ts
import { createPaymentClient } from 'yeetful/client'

const pay = createPaymentClient({
  wallet,                           // any viem WalletClient
  maxAmountAtomic: 1_000_000n,      // cap: 1 USDC per call
  allowedNetworks: ['base'],        // only pay on Base
  onPaymentRequired: async (req) => {
    console.log(`Pay ${req.maxAmountRequired} to ${req.payTo}?`)
    return true                     // return false to cancel
  },
})

// Use exactly like fetch.
const res = await pay('https://api.example.com/premium')
```

---

## Configuration

### `RouteGateOptions` — server

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `price` | `string \| number` | **required** | USD amount, e.g. `'0.01'`. Converted to USDC atomic units. |
| `recipient` | `Address` | **required** | Address that receives the payment. |
| `network` | `X402Network \| X402Network[]` | `'base'` | Networks you'll accept. Multi-chain = multi-item discovery. |
| `asset` | `Address` | USDC for network | Override to use a different ERC-20. |
| `description` | `string` | — | Shown to the paying client. |
| `maxTimeoutSeconds` | `number` | `600` | Validity window of the signed authorization. |
| `facilitator` | `FacilitatorConfig \| false` | hosted facilitator | Pass `false` to skip on-chain settlement (testing only). |

Supported networks: `base`, `base-sepolia`, `ethereum`, `optimism`, `arbitrum`, `polygon`.

### `ClientOptions` — client

| Option | Type | Notes |
| --- | --- | --- |
| `wallet` | `WalletClient` | Any viem wallet capable of signing EIP-712 typed data. |
| `maxAmountAtomic` | `bigint` | Reject requirements above this cap — safety belt. |
| `allowedNetworks` | `X402Network[]` | Only pay on these networks. |
| `onPaymentRequired` | `(req) => boolean \| Promise<boolean>` | Approval hook; return `false` to cancel. |
| `fetch` | `typeof fetch` | Override the underlying fetch (e.g. for timeouts). |

---

## How it works

1. **Client requests** a paid resource normally.
2. **Server** responds with `402 Payment Required` and a JSON body listing acceptable requirements (network, asset, amount, recipient).
3. **Client** picks the cheapest requirement, signs an [EIP-3009 `TransferWithAuthorization`](https://eips.ethereum.org/EIPS/eip-3009) with the user's wallet, and retries the request with an `X-PAYMENT` header (base64 JSON).
4. **Server** hands the signed payload to a facilitator which `verify`s the signature and `settle`s the transfer on-chain.
5. **Server** runs the handler and returns the response with an `X-PAYMENT-RESPONSE` header containing the transaction hash.

The signing is gasless for the payer — the facilitator broadcasts the transfer and picks up gas.

---

## Facilitators

By default the SDK uses the hosted facilitator at `https://facilitator.yeetful.com`. Override it anywhere you configure the server:

```ts
withPayment(
  {
    price: '0.01',
    recipient: '0xYourAddress',
    facilitator: {
      url: 'https://your-facilitator.example.com',
      authHeader: 'Bearer your-token',
    },
  },
  handler,
)
```

Pass `facilitator: false` to skip verification and settlement entirely — only useful for local testing.

---

## Advanced

### Accept multiple networks

```ts
withPayment(
  {
    price: '0.01',
    recipient: '0xYourAddress',
    network: ['base', 'optimism', 'arbitrum'],
  },
  handler,
)
```

Clients automatically pick the cheapest network they're configured to use.

### Sign a payment manually

```ts
import { signPayment } from 'yeetful/client'

const payment = await signPayment(wallet, {
  scheme: 'exact',
  network: 'base',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  maxAmountRequired: '10000', // 0.01 USDC
  payTo: '0xRecipient',
})
```

### Use with AI agents / MCP tools

x402 is a natural fit for agent tooling — drop `withPayment` in front of any MCP tool endpoint and agents with wallets can pay per-call. This SDK is what powers paid tools on [Yeetful](https://yeetful.com).

---

## API reference

### `yeetful/server`

- `gate(request, options)` — runtime-agnostic. Returns `{ type: 'paymentRequired', response }` or `{ type: 'ok', payer, settle }`.
- `Facilitator` — thin wrapper around verify/settle HTTP endpoints.
- `DEFAULT_FACILITATOR_URL` — the hosted facilitator URL.

### `yeetful/next`

- `withPayment(options, handler)` — wraps a Next.js route handler.

### `yeetful/express`

- `paymentRequired(options)` — returns an Express `RequestHandler`. Sets `req.x402.payer` after successful verification.

### `yeetful/client`

- `createPaymentClient(options)` — returns a `fetch`-compatible function that handles 402s automatically.
- `signPayment(wallet, requirement)` — sign a payment payload by hand.
- `PaymentError` — thrown when the client declines to pay.

### Helpers

- `usdcAddress(network)` — canonical USDC contract for a supported network.
- `usdToAtomic(amount, decimals?)` — safe USD → atomic-units conversion.
- `encodePayment` / `decodePayment` — base64 JSON codec for headers.

---

## Development

```bash
npm install
npm run build     # bundles ESM + CJS + d.ts via tsup
npm run typecheck
npm test
```

To publish:

```bash
npm run build
npm publish
```

---

## License

MIT © Yeetful
