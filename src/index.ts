/**
 * Yeetful — spend-controlled x402 for AI agents.
 *
 * Top-level entry re-exports the most common primitives. Use the subpath
 * entries for the agent expense account and framework-specific helpers:
 *
 *   - `yeetful/agent`   → grant-aware `yeetful()` paid fetch (the expense account)
 *   - `yeetful/client`  → low-level client-side fetch wrapper
 *   - `yeetful/server`  → runtime-agnostic `gate()`
 *   - `yeetful/next`    → Next.js App Router `withPayment()`
 *   - `yeetful/express` → Express `paymentRequired()` middleware
 */

export { yeetful, GrantError } from './agent.js'
export type {
  AgentBudget,
  AgentOptions,
  GrantPolicy,
  GrantViolation,
  HaltReason,
  HaltStatus,
  OrgBudget,
  Receipt,
  PayFn,
} from './agent.js'

export {
  createPaymentClient,
  signPayment,
  signExactAuthorization,
  requirementAtomicAmount,
  PaymentError,
} from './client.js'
export type { ClientOptions } from './client.js'

export { gate, Facilitator, DEFAULT_FACILITATOR_URL } from './server.js'
export type { RouteGateOptions } from './server.js'

export { usdcAddress, usdToAtomic, encodePayment, decodePayment, USDC_DECIMALS } from './utils.js'

export type {
  PaymentPayload,
  PaymentEnvelopeV2,
  PaymentRequirement,
  PaymentRequiredResponse,
  FacilitatorConfig,
  VerifyResult,
  SettleResult,
  X402Network,
  X402Scheme,
  ExactEvmPayload,
} from './types.js'
