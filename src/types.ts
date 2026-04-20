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
 */
export interface PaymentRequirement {
  scheme: X402Scheme
  network: X402Network
  /** Smart contract address of the payment asset (e.g. USDC). */
  asset: Address
  /** Atomic units owed (e.g. 10000 = 0.01 USDC at 6 decimals). */
  maxAmountRequired: string
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
 * The JSON body returned with an HTTP 402 response.
 * Matches the x402 spec's discovery document.
 */
export interface PaymentRequiredResponse {
  x402Version: 1
  accepts: PaymentRequirement[]
  error?: string
}

/**
 * A signed payment payload the client sends back in the `X-PAYMENT` header.
 * The body is a base64-encoded JSON of this shape.
 */
export interface PaymentPayload {
  x402Version: 1
  scheme: X402Scheme
  network: X402Network
  payload: ExactEvmPayload
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
