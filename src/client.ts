import type { Address, Hex, WalletClient } from 'viem'
import type {
  ExactEvmPayload,
  PaymentEnvelopeV2,
  PaymentPayload,
  PaymentRequiredResponse,
  PaymentRequirement,
  X402Network,
} from './types.js'
import { decodePayment, encodePayment, randomNonce } from './utils.js'

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
 * Create a fetch wrapper that transparently handles x402 payments —
 * protocol v1 ("base" networks, `maxAmountRequired`, `X-PAYMENT` header)
 * and v2 (CAIP-2 networks, `amount`, `PAYMENT-SIGNATURE` envelope) alike.
 *
 * On a 402 response, it picks the cheapest acceptable requirement,
 * signs an EIP-3009 authorization with the provided wallet, and retries
 * the request with the version-appropriate payment header.
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
    const requirement = selectRequirement(requirements.accepts ?? [], options)
    if (!requirement) {
      throw new PaymentError('No acceptable payment requirement matched client constraints', requirements)
    }

    if (options.onPaymentRequired) {
      const approved = await options.onPaymentRequired(requirement)
      if (!approved) throw new PaymentError('Payment rejected by user', requirements)
    }

    const payload = await signExactAuthorization(options.wallet, requirement)
    const header = buildPaymentHeader(requirements, requirement, payload)
    const headers = new Headers(init.headers)
    headers.set(header.name, header.value)

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

/**
 * Atomic units owed for a requirement, version-agnostic: x402 v2 prices in
 * `amount`, v1 in `maxAmountRequired`. Returns null when absent or
 * unparseable (never throws — selection must be able to skip bad entries).
 */
export function requirementAtomicAmount(req: PaymentRequirement): bigint | null {
  const raw = req.amount ?? req.maxAmountRequired
  if (raw == null) return null
  try {
    return BigInt(raw)
  } catch {
    return null
  }
}

async function parsePaymentRequired(res: Response): Promise<PaymentRequiredResponse> {
  let body: PaymentRequiredResponse | null = null
  try {
    body = (await res.clone().json()) as PaymentRequiredResponse
  } catch {
    body = null
  }
  if (hasUsableAccepts(body)) return body as PaymentRequiredResponse

  // v2 servers mirror the discovery document base64-encoded in the
  // `payment-required` response header. Fall back to it whenever the body
  // lacks a usable `accepts` — some servers ship a body of `{}`, which is
  // valid JSON but no challenge (the "parsed fine, zero requirements" trap).
  const header = res.headers.get('payment-required')
  if (header) {
    try {
      const decoded = decodePayment<PaymentRequiredResponse>(header)
      if (hasUsableAccepts(decoded)) return decoded
    } catch {
      /* fall through */
    }
  }

  // A parsed-but-unusable body still beats a parse error downstream: the
  // selector's "no requirement matched" carries the requirements for
  // debugging, where this throw carries nothing.
  if (body) return body
  throw new PaymentError('402 response did not contain a valid x402 discovery body')
}

function hasUsableAccepts(value: PaymentRequiredResponse | null | undefined): boolean {
  return !!value && Array.isArray(value.accepts) && value.accepts.length > 0
}

function selectRequirement(
  accepts: PaymentRequirement[],
  opts: ClientOptions,
): PaymentRequirement | undefined {
  const priced = accepts
    .filter((a) => a.scheme === 'exact')
    // Only EVM networks this client can sign for (drops e.g. "solana:…").
    .filter((a) => chainIdForNetwork(a.network) !== null)
    .filter(
      (a) =>
        !opts.allowedNetworks ||
        opts.allowedNetworks.some((n) => chainIdForNetwork(n) === chainIdForNetwork(a.network)),
    )
    .map((a) => ({ req: a, amount: requirementAtomicAmount(a) }))
    .filter((e): e is { req: PaymentRequirement; amount: bigint } => e.amount !== null)
    .filter((e) => !opts.maxAmountAtomic || e.amount <= opts.maxAmountAtomic)

  return priced.sort((a, b) => (a.amount < b.amount ? -1 : 1))[0]?.req
}

/** Build the version-appropriate payment header for a signed authorization. */
function buildPaymentHeader(
  challenge: PaymentRequiredResponse,
  requirement: PaymentRequirement,
  payload: ExactEvmPayload,
): { name: string; value: string } {
  const version = challenge.x402Version ?? 1
  if (version >= 2) {
    const envelope: PaymentEnvelopeV2 = {
      x402Version: version,
      resource: challenge.resource,
      accepted: requirement,
      payload,
      extensions: challenge.extensions ?? {},
    }
    return { name: 'PAYMENT-SIGNATURE', value: encodePayment(envelope) }
  }
  const v1: PaymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: requirement.network,
    payload,
  }
  return { name: 'X-PAYMENT', value: encodePayment(v1) }
}

/** Sign an EIP-3009 `TransferWithAuthorization` for the given requirement. */
export async function signExactAuthorization(
  wallet: WalletClient,
  requirement: PaymentRequirement,
): Promise<ExactEvmPayload> {
  const account = wallet.account
  if (!account) throw new PaymentError('Wallet has no account attached')

  const value = requirementAtomicAmount(requirement)
  if (value === null) {
    throw new PaymentError('x402 requirement is missing a payment amount')
  }
  const chainId = chainIdForNetwork(requirement.network)
  if (chainId === null) {
    throw new PaymentError(`Unsupported x402 network: ${requirement.network}`)
  }

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
      chainId,
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
      value,
      validAfter,
      validBefore,
      nonce,
    },
  })) as Hex

  return {
    signature,
    authorization: {
      from: account.address as Address,
      to: requirement.payTo,
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  }
}

/**
 * Sign a requirement into the x402 **v1** `X-PAYMENT` payload shape.
 * Kept for back-compat; `createPaymentClient` is version-aware internally.
 */
export async function signPayment(
  wallet: WalletClient,
  requirement: PaymentRequirement,
): Promise<PaymentPayload> {
  return {
    x402Version: 1,
    scheme: 'exact',
    network: requirement.network,
    payload: await signExactAuthorization(wallet, requirement),
  }
}

/** Resolve a network to an EVM chain id — v1 friendly names and CAIP-2 ids. */
function chainIdForNetwork(network: string): number | null {
  if (network.startsWith('eip155:')) {
    const id = Number(network.slice('eip155:'.length))
    return Number.isInteger(id) && id > 0 ? id : null
  }
  switch (network as X402Network) {
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
    default:
      return null
  }
}
