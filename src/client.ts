import type { Address, Hex, WalletClient } from 'viem'
import type {
  PaymentPayload,
  PaymentRequiredResponse,
  PaymentRequirement,
  X402Network,
} from './types.js'
import { encodePayment, randomNonce } from './utils.js'

export interface ClientOptions {
  /** A viem WalletClient able to sign EIP-712 typed data. */
  wallet: WalletClient
  /** Underlying fetch to wrap (defaults to global fetch). */
  fetch?: typeof fetch
  /**
   * Hook called before signing. Return `false` to reject the payment.
   * Useful for showing a confirmation UI to the user.
   */
  onPaymentRequired?: (requirement: PaymentRequirement) => boolean | Promise<boolean>
  /** Only allow payments up to this atomic-units cap. Safety belt. */
  maxAmountAtomic?: bigint
  /** Restrict to specific networks (defaults to all). */
  allowedNetworks?: X402Network[]
}

/**
 * Create a fetch wrapper that transparently handles x402 payments.
 *
 * On a 402 response, it picks the cheapest acceptable requirement,
 * signs an EIP-3009 authorization with the provided wallet, and retries
 * the request with an `X-PAYMENT` header.
 *
 * @example
 * ```ts
 * const pay = createPaymentClient({ wallet })
 * const res = await pay('https://api.example.com/premium')
 * ```
 */
export function createPaymentClient(options: ClientOptions) {
  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis)

  return async function payFetch(
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> {
    const first = await baseFetch(input, init)
    if (first.status !== 402) return first

    const requirements = await parsePaymentRequired(first)
    const requirement = selectRequirement(requirements.accepts, options)
    if (!requirement) {
      throw new PaymentError('No acceptable payment requirement matched client constraints', requirements)
    }

    if (options.onPaymentRequired) {
      const approved = await options.onPaymentRequired(requirement)
      if (!approved) throw new PaymentError('Payment rejected by user', requirements)
    }

    const payment = await signPayment(options.wallet, requirement)
    const headers = new Headers(init.headers)
    headers.set('X-PAYMENT', encodePayment(payment))

    return baseFetch(input, { ...init, headers })
  }
}

export class PaymentError extends Error {
  readonly requirements?: PaymentRequiredResponse
  constructor(message: string, requirements?: PaymentRequiredResponse) {
    super(message)
    this.name = 'PaymentError'
    this.requirements = requirements
  }
}

async function parsePaymentRequired(res: Response): Promise<PaymentRequiredResponse> {
  try {
    return (await res.clone().json()) as PaymentRequiredResponse
  } catch {
    throw new PaymentError('402 response did not contain a valid x402 discovery body')
  }
}

function selectRequirement(
  accepts: PaymentRequirement[],
  opts: ClientOptions,
): PaymentRequirement | undefined {
  const filtered = accepts
    .filter((a) => a.scheme === 'exact')
    .filter((a) => !opts.allowedNetworks || opts.allowedNetworks.includes(a.network))
    .filter((a) => !opts.maxAmountAtomic || BigInt(a.maxAmountRequired) <= opts.maxAmountAtomic)

  return filtered.sort((a, b) =>
    BigInt(a.maxAmountRequired) < BigInt(b.maxAmountRequired) ? -1 : 1,
  )[0]
}

/** Sign an EIP-3009 `TransferWithAuthorization` for the given requirement. */
export async function signPayment(
  wallet: WalletClient,
  requirement: PaymentRequirement,
): Promise<PaymentPayload> {
  const account = wallet.account
  if (!account) throw new PaymentError('Wallet has no account attached')

  const now = Math.floor(Date.now() / 1000)
  const validAfter = BigInt(now - 60)
  const validBefore = BigInt(now + (requirement.maxTimeoutSeconds ?? 600))
  const nonce = randomNonce()

  const tokenName =
    (requirement.extra?.name as string | undefined) ?? 'USD Coin'
  const tokenVersion =
    (requirement.extra?.version as string | undefined) ?? '2'

  const signature = (await wallet.signTypedData({
    account,
    domain: {
      name: tokenName,
      version: tokenVersion,
      chainId: chainIdForNetwork(requirement.network),
      verifyingContract: requirement.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: account.address as Address,
      to: requirement.payTo,
      value: BigInt(requirement.maxAmountRequired),
      validAfter,
      validBefore,
      nonce,
    },
  })) as Hex

  return {
    x402Version: 1,
    scheme: 'exact',
    network: requirement.network,
    payload: {
      signature,
      authorization: {
        from: account.address as Address,
        to: requirement.payTo,
        value: requirement.maxAmountRequired,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  }
}

function chainIdForNetwork(network: X402Network): number {
  switch (network) {
    case 'base':
      return 8453
    case 'base-sepolia':
      return 84532
    case 'ethereum':
      return 1
    case 'optimism':
      return 10
    case 'arbitrum':
      return 42161
    case 'polygon':
      return 137
  }
}
