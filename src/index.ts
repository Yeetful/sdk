/**
 * Yeetful — drop-in x402 payments for APIs and clients.
 *
 * Top-level entry re-exports the most common primitives. Use the subpath
 * entries for framework-specific helpers:
 *
 *   - `yeetful/client`  → client-side fetch wrapper
 *   - `yeetful/server`  → runtime-agnostic `gate()`
 *   - `yeetful/next`    → Next.js App Router `withPayment()`
 *   - `yeetful/express` → Express `paymentRequired()` middleware
 */

export { createPaymentClient, signPayment, PaymentError } from './client.js'
export type { ClientOptions } from './client.js'

export { gate, Facilitator, DEFAULT_FACILITATOR_URL } from './server.js'
export type { RouteGateOptions } from './server.js'

export { usdcAddress, usdToAtomic, encodePayment, decodePayment } from './utils.js'

export type {
  PaymentPayload,
  PaymentRequirement,
  PaymentRequiredResponse,
  FacilitatorConfig,
  VerifyResult,
  SettleResult,
  X402Network,
  X402Scheme,
  ExactEvmPayload,
} from './types.js'
