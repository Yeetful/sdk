import type { X402Network } from './types.js'

const USDC_BY_NETWORK: Record<X402Network, `0x${string}`> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
}

/** USDC has 6 decimal places on every supported x402 network. */
export const USDC_DECIMALS = 6

/**
 * The canonical USDC contract address for a supported x402 network.
 *
 * @param network One of `base`, `base-sepolia`, `ethereum`, `optimism`, `arbitrum`, `polygon`.
 * @returns The 0x-prefixed USDC token address on that network.
 */
export function usdcAddress(network: X402Network): `0x${string}` {
  return USDC_BY_NETWORK[network]
}

/**
 * Convert a human-friendly USD amount into atomic USDC units (a decimal string).
 *
 * Uses fixed-point **string** math, never floating point, so values like `"0.01"`
 * can't drift. Fractional digits beyond `decimals` are truncated (not rounded).
 *
 * @param amount A non-negative amount as a string (`"0.01"`) or number (`0.01`).
 * @param decimals Token decimals — USDC is 6 (the default).
 * @returns The atomic amount as a base-10 string, e.g. `usdToAtomic("0.01")` → `"10000"`.
 * @throws If `amount` is not a non-negative decimal number.
 */
export function usdToAtomic(amount: string | number, decimals = USDC_DECIMALS): string {
  const str = typeof amount === 'number' ? amount.toString() : amount
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid amount: ${str}`)
  }
  const [whole, frac = ''] = str.split('.')
  const padded = frac.slice(0, decimals).padEnd(decimals, '0')
  return (BigInt(whole ?? '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')).toString()
}

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * Base64-encode a JSON value for an x402 payment header. Works in Node 18+ and
 * browsers. Round-trips with {@link decodePayment}.
 *
 * @param value Any JSON-serializable value (typically a payment payload).
 * @returns The base64 string for the `X-PAYMENT` / `PAYMENT-SIGNATURE` header.
 */
export function encodePayment(value: unknown): string {
  const bytes = utf8Encoder.encode(JSON.stringify(value))
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Base64-decode an x402 payment header value back into JSON — the inverse of
 * {@link encodePayment}.
 *
 * @typeParam T The expected shape of the decoded value (the caller asserts it).
 * @param b64 The base64 header value.
 * @returns The parsed value as `T`.
 * @throws If `b64` is not valid base64 or the decoded bytes aren't valid JSON.
 */
export function decodePayment<T = unknown>(b64: string): T {
  let bytes: Uint8Array
  if (typeof Buffer !== 'undefined') {
    bytes = new Uint8Array(Buffer.from(b64, 'base64'))
  } else {
    const binary = atob(b64)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  }
  return JSON.parse(utf8Decoder.decode(bytes)) as T
}

/** Generate a random 32-byte nonce as a 0x-prefixed hex string. */
export function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return ('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
}
