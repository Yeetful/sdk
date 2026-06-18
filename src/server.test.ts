import { describe, it, expect, vi, afterEach } from 'vitest'
import { reportUsage, DEFAULT_RECEIPTS_URL } from './server.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('reportUsage', () => {
  it('POSTs to the canonical endpoint with Bearer auth + the receipt body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const ok = await reportUsage({
      apiKey: 'yf_test',
      mcp: 'my-mcp',
      amountUsd: '0.01',
      payer: '0xPAYER',
      tool: 'list_proposals',
      network: 'base',
    })

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(DEFAULT_RECEIPTS_URL)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer yf_test')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ mcp: 'my-mcp', amountUsd: 0.01, payer: '0xPAYER', tool: 'list_proposals', network: 'base' })
  })

  it('honours a custom url', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await reportUsage({ apiKey: 'yf_x', mcp: 'm', amountUsd: 1, url: 'https://example.test/r' })
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe('https://example.test/r')
  })

  it('returns false on a non-2xx without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })))
    await expect(reportUsage({ apiKey: 'yf_x', mcp: 'm', amountUsd: 1 })).resolves.toBe(false)
  })

  it('swallows a network error and returns false (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))
    await expect(reportUsage({ apiKey: 'yf_x', mcp: 'm', amountUsd: 1 })).resolves.toBe(false)
  })
})
