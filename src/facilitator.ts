import type {
  FacilitatorConfig,
  PaymentPayload,
  PaymentRequirement,
  SettleResult,
  VerifyResult,
} from './types.js'

/**
 * Thin wrapper around an x402 facilitator HTTP service.
 * The facilitator verifies signed payment authorizations and settles them on-chain.
 */
export class Facilitator {
  private readonly url: string
  private readonly authHeader?: string
  private readonly fetcher: typeof fetch

  constructor(config: FacilitatorConfig) {
    this.url = config.url.replace(/\/$/, '')
    this.authHeader = config.authHeader
    this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async verify(
    payment: PaymentPayload,
    requirement: PaymentRequirement,
  ): Promise<VerifyResult> {
    return this.post<VerifyResult>('/verify', { paymentPayload: payment, paymentRequirements: requirement })
  }

  async settle(
    payment: PaymentPayload,
    requirement: PaymentRequirement,
  ): Promise<SettleResult> {
    return this.post<SettleResult>('/settle', { paymentPayload: payment, paymentRequirements: requirement })
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetcher(this.url + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.authHeader ? { authorization: this.authHeader } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Facilitator ${path} failed: ${res.status} ${text}`)
    }
    return (await res.json()) as T
  }
}

/** Default hosted facilitator. Override for self-hosted deployments. */
export const DEFAULT_FACILITATOR_URL = 'https://facilitator.yeetful.com'
