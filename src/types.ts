import type { Address, Hex } from 'viem'

export type X402Network =
  | 'base'
  | 'base-sepolia'
  | 'ethereum'
  | 'optimism'
  | 'arbitrum'
  | 'polygon'

export type X402Scheme = 'exact'

/**
 * A single acceptable way to satisfy a payment requirement.
 * Servers may advertise multiple (e.g. USDC on Base and USDC on Optimism).
 *
 * Field names differ by protocol version: x402 v1 prices in
 * `maxAmountRequired` with friendly network names ("base"); v2 prices in
 * `amount` with CAIP-2 network ids ("eip155:8453"). Read amounts via
 * `requirementAtomicAmount()` rather than either field directly.
 */
export interface PaymentRequirement {
  scheme: X402Scheme
  /** v1 friendly name ("base") or v2 CAIP-2 id ("eip155:8453", "solana:…"). */
  network: X402Network | (string & {})
  /** Smart contract address of the payment asset (e.g. USDC). */
  asset: Address
  /** Atomic units owed — x402 v1 (e.g. 10000 = 0.01 USDC at 6 decimals). */
  maxAmountRequired?: string
  /** Atomic units owed — x402 v2. */
  amount?: string
  /** Recipient address that receives the payment. */
  payTo: Address
  /** Human-readable description of what the buyer is paying for. */
  description?: string
  /** Resource URL being paid for. */
  resource?: string
  /** Seconds the signed authorization remains valid. */
  maxTimeoutSeconds?: number
  /** Optional scheme-specific extra data. */
  extra?: Record<string, unknown>
}

/**
 * The JSON body returned with an HTTP 402 response (x402 v1 and v2).
 * v2 also mirrors it base64-encoded in the `payment-required` response header.
 */
export interface PaymentRequiredResponse {
  x402Version: number
  accepts: PaymentRequirement[]
  error?: string
  /** v2: what is being paid for ({ url, description, mimeType }). */
  resource?: unknown
  /** v2: protocol extensions (e.g. the bazaar discovery extension). */
  extensions?: Record<string, unknown>
}

/**
 * A signed payment payload the client sends back in the `X-PAYMENT` header
 * (x402 v1). The header value is a base64-encoded JSON of this shape.
 */
export interface PaymentPayload {
  x402Version: 1
  scheme: X402Scheme
  network: X402Network | (string & {})
  payload: ExactEvmPayload
}

/**
 * The x402 v2 payment envelope, sent base64-encoded in the
 * `PAYMENT-SIGNATURE` request header: the chosen requirement echoed back in
 * `accepted`, alongside the server's `resource` and `extensions`.
 */
export interface PaymentEnvelopeV2 {
  x402Version: number
  resource?: unknown
  accepted: PaymentRequirement
  payload: ExactEvmPayload
  extensions?: Record<string, unknown>
}

/**
 * EIP-3009 transferWithAuthorization payload for the `exact` scheme.
 */
export interface ExactEvmPayload {
  signature: Hex
  authorization: {
    from: Address
    to: Address
    value: string
    validAfter: string
    validBefore: string
    nonce: Hex
  }
}

/** Result of a facilitator verify call. */
export interface VerifyResult {
  isValid: boolean
  invalidReason?: string
  payer?: Address
}

/** Result of a facilitator settle call. */
export interface SettleResult {
  success: boolean
  transaction?: Hex
  network?: X402Network
  errorReason?: string
  payer?: Address
}

/** Config for talking to an x402 facilitator service. */
export interface FacilitatorConfig {
  url: string
  /** Optional auth header value, e.g. `Bearer <token>`. */
  authHeader?: string
  /** Pluggable fetcher (defaults to global fetch). */
  fetch?: typeof fetch
}
